"""Development punch list — track ideas, bugs and model changes across iterations."""

import pandas as pd
import streamlit as st

from deercast import __version__, ui

st.title("🛠️ Development")
st.caption(f"Deercast v{__version__} · storage: **{ui.get_store().kind}**")
if ui.get_store().kind == "local":
    st.warning(
        "Using temporary local storage — items will be lost when the Streamlit app restarts. "
        "Add the `[storage]` secrets (see README) to save to Supabase."
    )

STATUSES = ["Open", "In progress", "Done", "Won't do"]
PRIORITIES = ["High", "Medium", "Low"]
CATEGORIES = ["Feature", "Bug", "Model", "UI", "Data", "Infra"]

SEED = [
    ("Use state-agency peak rut dates (by state/region) instead of latitude default", "Model", "High"),
    ("Thermals: morning/evening thermal drift using elevation (DEM) data on scent cones", "Feature", "High"),
    ("Hunt log: record sightings per stand/hour to validate & tune the model", "Feature", "High"),
    ("Calibrate factor weights against hunt log + published studies", "Model", "Medium"),
    ("Google Maps basemap option (needs Maps API key)", "UI", "Medium"),
    ("Wind field grid (multi-point) over property instead of single point", "Feature", "Low"),
    ("Best stand for tomorrow: rank stands by score x wind suitability", "Feature", "Medium"),
    ("PWA / home-screen icon polish for phone use", "UI", "Low"),
]
items = ui.load("punchlist", [
    {"id": ui.new_id(), "title": t, "category": c, "priority": p, "status": "Open", "details": "",
     "created": ui.now_str(), "updated": ui.now_str()} for t, c, p in SEED
])

with st.form("new_item", clear_on_submit=True):
    st.markdown("**Add punch list item**")
    title = st.text_input("Title")
    c1, c2 = st.columns(2)
    cat = c1.selectbox("Category", CATEGORIES)
    pri = c2.selectbox("Priority", PRIORITIES, index=1)
    desc = st.text_area("Details", height=80)
    if st.form_submit_button("Add", type="primary"):
        if title.strip():
            items = items + [{
                "id": ui.new_id(), "title": title.strip(), "category": cat, "priority": pri, "status": "Open",
                "details": desc, "created": ui.now_str(), "updated": ui.now_str(),
            }]
            if ui.save("punchlist", items, f"Punch list: add '{title.strip()}'"):
                st.rerun()
        else:
            st.error("Title is required.")

f1, f2 = st.columns(2)
show = f1.multiselect("Status", STATUSES, default=["Open", "In progress"])
cats = f2.multiselect("Category", CATEGORIES, default=CATEGORIES)

if not items:
    st.info("No items yet.")
    st.stop()

df = pd.DataFrame(items)
for col in ["details", "updated"]:
    if col not in df:
        df[col] = ""
view = df[df["status"].isin(show) & df["category"].isin(cats)].copy()
view["_p"] = view["priority"].map({p: i for i, p in enumerate(PRIORITIES)})
view = view.sort_values(["_p", "created"]).drop(columns="_p")

edited = st.data_editor(
    view[["id", "title", "status", "priority", "category", "details", "created", "updated"]],
    hide_index=True,
    use_container_width=True,
    disabled=["id", "created", "updated"],
    column_config={
        "id": None,
        "status": st.column_config.SelectboxColumn(options=STATUSES, required=True),
        "priority": st.column_config.SelectboxColumn(options=PRIORITIES, required=True),
        "category": st.column_config.SelectboxColumn(options=CATEGORIES, required=True),
        "details": st.column_config.TextColumn(width="large"),
    },
    key="punch_editor",
)

if st.button("Save changes", type="primary"):
    by_id = {r["id"]: r for r in edited.to_dict("records")}
    changed = 0
    for it in items:
        e = by_id.get(it["id"])
        if e and any(it.get(k) != e[k] for k in ["title", "status", "priority", "category", "details"]):
            it.update({k: e[k] for k in ["title", "status", "priority", "category", "details"]})
            it["updated"] = ui.now_str()
            changed += 1
    if changed and ui.save("punchlist", items, f"Punch list: update {changed} item(s)"):
        st.success(f"Saved {changed} change(s).")
        st.rerun()
    elif not changed:
        st.info("No changes.")

done = sum(i["status"] == "Done" for i in items)
st.caption(f"{len(items)} items · {done} done")

with st.expander("📋 Export for a new Claude session"):
    lines = [f"- [{i['status']}] ({i['priority']}, {i['category']}) {i['title']}" + (f" — {i['details']}" if i.get("details") else "")
             for i in sorted(items, key=lambda x: (STATUSES.index(x["status"]), PRIORITIES.index(x["priority"])))]
    st.code("\n".join(lines) or "(empty)", language="markdown")
    st.caption("Tap the copy icon and paste this into NEW_SESSION_PROMPT.txt where it says 'Punch list export'.")

