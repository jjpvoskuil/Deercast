"""Hunting grounds: switch, create, set home location, share with members. Admins manage who can sign in."""

import streamlit as st

from deercast import accounts, ui

st.title("🏞️ Hunting Grounds")
st.caption("A ground is a property. Its stands, bait, water/cover marks and deer sightings are shared with its "
           "members. Hunt logs, bow setups and shots stay personal.")

me = ui.current_email()
grounds = ui.grounds()
users = ui.load("users", {}) or {}
cur = ui.current_ground()


def name_of(email):
    return (users.get(email) or {}).get("name") or email


def save_grounds(gs, msg):
    if ui.save("grounds", gs, msg):
        st.rerun()


# ---------------------------------------------------------------- my grounds
st.subheader("Your grounds")
mine = accounts.my_grounds(grounds, me)
if not mine:
    st.info("You don't have a hunting ground yet — create one below.")
for g in mine:
    owner = g["owner"] == me
    c1, c2 = st.columns([3, 1])
    c1.markdown(f"**{g['name']}**" + (" ✅ current" if cur and g["id"] == cur["id"] else "")
                + f"  \n<small>{'You own it' if owner else 'Shared by ' + name_of(g['owner'])} · "
                  f"{len(g.get('members', []))} member(s) · home: {(g.get('home') or {}).get('label', '—')}</small>",
                unsafe_allow_html=True)
    if not (cur and g["id"] == cur["id"]) and c2.button("Switch", key=f"sw_{g['id']}", width="stretch"):
        st.session_state._ground_next = g["id"]
        st.rerun()

# ---------------------------------------------------------------- current ground settings
if cur:
    st.subheader(f"⚙️ {cur['name']}")
    if not accounts.can_edit_ground(cur, me):
        st.caption(f"Owned by {name_of(cur['owner'])}. Only the owner can change its settings or members.")
        st.markdown("**Members:** " + ", ".join(name_of(m) for m in cur.get("members", [])))
        if st.button("Leave this ground"):
            st.session_state[f"_leave_{cur['id']}"] = True
        if st.session_state.get(f"_leave_{cur['id']}"):
            st.warning("Leave this ground? You'll lose access to its shared map. Your own hunt logs are kept.")
            if st.button("Yes, leave", type="primary"):
                for x in grounds:
                    if x["id"] == cur["id"]:
                        x["members"] = [m for m in x["members"] if m != me]
                st.session_state.pop("ground_id", None)
                save_grounds(grounds, f"{me} left {cur['name']}")
    else:
        with st.form("ground_name"):
            new_name = st.text_input("Name", cur["name"])
            if st.form_submit_button("Rename") and new_name.strip() and new_name.strip() != cur["name"]:
                for x in grounds:
                    if x["id"] == cur["id"]:
                        x["name"] = new_name.strip()
                save_grounds(grounds, f"Rename ground → {new_name.strip()}")

        st.markdown("**Home location** — where the forecast, map and regulations open for this ground")
        home = cur.get("home") or {}
        st.caption(f"Now: {home.get('label', '—')} ({home.get('lat', 0):.4f}, {home.get('lon', 0):.4f})")
        h1, h2 = st.columns(2)
        with h1.form("home_zip", clear_on_submit=True):
            z = st.text_input("Set from ZIP code", max_chars=5)
            if st.form_submit_button("Use ZIP") and z:
                try:
                    loc = ui.cached_zip(z)
                    for x in grounds:
                        if x["id"] == cur["id"]:
                            x["home"] = {"lat": loc.lat, "lon": loc.lon, "label": loc.label, "state": loc.state,
                                         "zip": loc.zip_code}
                    ui.set_location(loc)
                    save_grounds(grounds, f"Home of {cur['name']} → ZIP {z}")
                except ValueError as e:
                    st.error(str(e))
        loc_now = ui.get_location()
        if h2.button(f"Use current location ({loc_now.label[:28]})", width="stretch"):
            for x in grounds:
                if x["id"] == cur["id"]:
                    x["home"] = {"lat": loc_now.lat, "lon": loc_now.lon, "label": cur["name"],
                                 "state": loc_now.state or ui.state_for(loc_now.lat, loc_now.lon),
                                 "zip": loc_now.zip_code}
            save_grounds(grounds, f"Home of {cur['name']} → current location")
        st.caption("Tip: tap a spot on the 🗺️ Map → 'Forecast this pin', then come back and use current location.")

        st.markdown("**Members**")
        for m in cur.get("members", []):
            c1, c2 = st.columns([4, 1])
            c1.markdown(f"• {name_of(m)}" + (" (owner)" if m == cur["owner"] else "")
                        + f"  <small>{m}</small>", unsafe_allow_html=True)
            if m != cur["owner"] and c2.button("Remove", key=f"rm_{m}"):
                for x in grounds:
                    if x["id"] == cur["id"]:
                        x["members"] = [y for y in x["members"] if y != m]
                save_grounds(grounds, f"Remove {m} from {cur['name']}")
        addable = [e for e in users if e not in cur.get("members", []) and e != accounts.LOCAL_EMAIL]
        if addable:
            c1, c2 = st.columns([3, 1])
            who = c1.selectbox("Add a member", addable, format_func=lambda e: f"{name_of(e)} ({e})",
                               key="add_member")
            if c2.button("Add", width="stretch"):
                for x in grounds:
                    if x["id"] == cur["id"]:
                        x["members"].append(who)
                save_grounds(grounds, f"Add {who} to {cur['name']}")
        else:
            st.caption("Everyone who can sign in is already a member. " +
                       ("Add new people under **App users** below." if ui.is_admin() else
                        "Ask the app admin to add someone as an app user first."))

        with st.expander("Delete this ground"):
            st.caption("Removes the ground for all members. Its stand/bait files are kept in the data repo as a "
                       "backup; members' personal hunt logs are not touched.")
            if st.button(f"Delete “{cur['name']}”", type="primary", key="del_ground"):
                st.session_state.pop("ground_id", None)
                save_grounds([x for x in grounds if x["id"] != cur["id"]], f"Delete ground {cur['name']}")

# ---------------------------------------------------------------- new ground
with st.expander("➕ Create a hunting ground"):
    with st.form("new_ground", clear_on_submit=True):
        n = st.text_input("Name", placeholder="e.g. Ohio lease, Dad's farm")
        z = st.text_input("Home ZIP code (optional — otherwise your current location)", max_chars=5)
        if st.form_submit_button("Create", type="primary"):
            if not n.strip():
                st.error("Give it a name.")
            else:
                try:
                    loc = ui.cached_zip(z) if z else ui.get_location()
                    home = {"lat": loc.lat, "lon": loc.lon, "label": loc.label if z else n.strip(),
                            "state": loc.state or ui.state_for(loc.lat, loc.lon), "zip": loc.zip_code}
                    g_new = accounts.new_ground(n, me, home)
                    if ui.save("grounds", grounds + [g_new], f"Create ground {n.strip()}"):
                        st.session_state._ground_next = g_new["id"]
                        st.rerun()
                except ValueError as e:
                    st.error(str(e))

# ---------------------------------------------------------------- app users (admin)
if ui.is_admin():
    st.subheader("👥 App users")
    st.caption("Only these Google accounts can sign in. Add someone here, then add them to a ground above.")
    for e, u in sorted(users.items()):
        if e == accounts.LOCAL_EMAIL:
            continue
        c1, c2 = st.columns([4, 1])
        c1.markdown(f"• **{u.get('name') or e}** <small>{e}</small>" + (" · admin" if u.get("role") == "admin" else ""),
                    unsafe_allow_html=True)
        if e != me and c2.button("Remove", key=f"rmu_{e}"):
            users.pop(e, None)
            for x in grounds:
                x["members"] = [m for m in x.get("members", []) if m != e]
            ui.save("grounds", grounds, f"Remove user {e} from grounds")
            ui.save("users", users, f"Remove user {e}")
            st.rerun()
    with st.form("add_user", clear_on_submit=True):
        c1, c2 = st.columns(2)
        ne = c1.text_input("Google email")
        nn = c2.text_input("Name")
        add_to = st.checkbox(f"Also add to “{cur['name']}”" if cur else "Also add to current ground",
                             value=bool(cur and accounts.can_edit_ground(cur, me)), disabled=not cur)
        if st.form_submit_button("Add user", type="primary"):
            e = accounts.norm_email(ne)
            if "@" not in e:
                st.error("Enter a valid email address.")
            else:
                users.setdefault(e, {"name": nn.strip() or e.split("@")[0], "role": "user", "last_ground": None})
                ui.save("users", users, f"Add user {e}")
                if add_to and cur and e not in cur.get("members", []):
                    for x in grounds:
                        if x["id"] == cur["id"]:
                            x["members"].append(e)
                    ui.save("grounds", grounds, f"Add {e} to {cur['name']}")
                st.success(f"Added {nn.strip() or e}. They can now sign in with Google.")
                st.rerun()
