import { useEffect, useMemo, useState } from "react";
import "./Checklist.css";
import { collection, addDoc, updateDoc, deleteDoc, doc, query, where, onSnapshot, serverTimestamp } from "firebase/firestore";
import { db, auth } from "./firebase";

const CATEGORIES = ["Documents", "Money", "Electronics", "Clothes", "Other"];
const ICONS = { Documents: "📄", Money: "💴", Electronics: "🔌", Clothes: "👕", Other: "📦" };
const EMPTY = { name: "", category: "Documents", completionMode: "once" };

export default function Checklist({ trip, selectedTripId = null, dashboardMode, onDashboardModeChange, selectedGroupId: sharedSelectedGroupId, onSelectedGroupChange }) {
  const uid = auth.currentUser?.uid;
  const [localMode, setLocalMode] = useState("personal");
  const mode = dashboardMode === "personal" || dashboardMode === "group" ? dashboardMode : localMode;
  const setMode = onDashboardModeChange || setLocalMode;
  const [groups, setGroups] = useState([]);
  const [groupsLoading, setGroupsLoading] = useState(true);
  const [localGroupId, setLocalGroupId] = useState("");
  const groupId = typeof sharedSelectedGroupId === "string" ? sharedSelectedGroupId : localGroupId;
  const setGroupId = onSelectedGroupChange || setLocalGroupId;
  const group = groups.find(g => g.id === groupId);
  const members = Array.isArray(group?.memberIds) ? group.memberIds : [];
  const [tab, setTab] = useState("shared");
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ ...EMPTY });

  useEffect(() => {
    if (!uid) { setGroups([]); setGroupsLoading(false); return; }
    setGroupsLoading(true);
    return onSnapshot(query(collection(db, "groups"), where("memberIds", "array-contains", uid)),
      snap => { setGroups(snap.docs.map(d => ({ id: d.id, ...d.data() }))); setGroupsLoading(false); },
      err => { console.error("Checklist groups:", err); setGroupsLoading(false); setError("Unable to load groups."); });
  }, [uid]);

  useEffect(() => {
    if (groupsLoading) return;
    if (groupId && groups.some(g => g.id === groupId)) return;
    const next = groups[0]?.id || "";
    if (next !== groupId) setGroupId(next);
  }, [groups, groupsLoading, groupId, onSelectedGroupChange]);

  // Personal trip: existing path. Group Shared: existing path. Group Personal: user-owned path.
  const path = useMemo(() => {
    if (!uid) return null;
    if (mode === "group") {
      if (!groupId || !group) return null;
      return tab === "shared" ? ["groups", groupId, "checklist"] : ["users", uid, "groupChecklists", groupId, "items"];
    }
    return ["users", uid, ...(selectedTripId ? ["trips", selectedTripId] : []), "checklist"];
  }, [uid, mode, groupId, group, tab, selectedTripId]);

  useEffect(() => {
    setItems([]); setError(""); setShowForm(false); setEditingId(null); setForm({ ...EMPTY });
    if (!path) { setLoading(false); return; }
    setLoading(true);
    return onSnapshot(collection(db, ...path), snap => {
      setItems(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoading(false);
    }, err => { console.error("Checklist subscription:", err); setItems([]); setLoading(false); setError("Unable to load checklist. Check Firestore rules."); });
  }, [path?.join("/")]);

  const isEveryone = item => mode === "group" && tab === "shared" && item.completionMode === "everyone";
  const isDone = item => isEveryone(item) ? item.completedBy?.[uid] === true : item.completed === true;
  const doneCount = items.filter(isDone).length;
  const progress = items.length ? Math.round(doneCount / items.length * 100) : 0;
  const ref = id => doc(db, ...path, id);
  const reset = () => { setShowForm(false); setEditingId(null); setForm({ ...EMPTY }); };
  const save = async e => {
    e.preventDefault();
    if (!path || !uid || !form.name.trim()) return;
    setSaving(true); setError("");
    try {
      const data = { name: form.name.trim(), category: form.category };
      if (editingId) {
        const existing = items.find(i => i.id === editingId);
        const oldMode = existing?.completionMode || "once";
        const changingMode = mode === "group" && tab === "shared" && oldMode !== form.completionMode;
        if (changingMode && !window.confirm("Changing the completion type will reset this task's completion progress for everyone. Continue?")) return;
        await updateDoc(ref(editingId), {
          ...data,
          ...(changingMode ? { completionMode: form.completionMode, completed: false, completedBy: {} } : {}),
          updatedAt: serverTimestamp()
        });
      } else {
        await addDoc(collection(db, ...path), {
          ...data, completed: false, createdBy: uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
          ...(mode === "group" && tab === "shared" ? { completionMode: form.completionMode, completedBy: {} } : {})
        });
      }
      reset();
    } catch (err) { console.error("Checklist save:", err); setError(`Unable to save item (${err.code || "error"}).`); }
    finally { setSaving(false); }
  };
  const toggle = async item => {
    try {
      if (isEveryone(item)) {
        await updateDoc(ref(item.id), { [`completedBy.${uid}`]: !isDone(item), updatedAt: serverTimestamp() });
      } else {
        await updateDoc(ref(item.id), { completed: !isDone(item), updatedAt: serverTimestamp() });
      }
    } catch (err) { console.error("Checklist toggle:", err); setError(`Unable to update item (${err.code || "error"}).`); }
  };
  const remove = async item => {
    if (!window.confirm(`Delete "${item.name}"?`)) return;
    try { await deleteDoc(ref(item.id)); }
    catch (err) { console.error("Checklist delete:", err); setError(`Unable to delete item (${err.code || "error"}).`); }
  };
  const edit = item => { setEditingId(item.id); setForm({ name: item.name, category: item.category, completionMode: item.completionMode || "once" }); setShowForm(true); };
  const changeMode = next => { setMode(next); reset(); setError(""); };
  const changeTab = next => { setTab(next); reset(); setError(""); };

  return <div className="checklist-page">
    <header className="checklist-header"><div><p>✈️ {mode === "group" ? group?.tripSettings?.name || group?.name || "Group Trip" : trip?.name || "My Trip"}</p><h1>Checklist</h1></div>
      <button className="add-button" disabled={!path} onClick={() => showForm ? reset() : (setForm({ ...EMPTY }), setEditingId(null), setShowForm(true))}>{showForm ? "Cancel" : "+ Add"}</button>
    </header>
    <div className="checklist-mode-switch"><button className={mode === "personal" ? "active" : ""} onClick={() => changeMode("personal")}>Personal Trip</button><button className={mode === "group" ? "active" : ""} onClick={() => changeMode("group")}>Group Trip</button></div>
    {mode === "group" && <section className="checklist-group-selector"><label htmlFor="checklist-group">Select Group</label>
      {groups.length ? <select id="checklist-group" value={groupId} onChange={e => { setGroupId(e.target.value); reset(); }}>{groups.map(g => <option key={g.id} value={g.id}>{g.tripSettings?.name || g.name}</option>)}</select> : <p>Join or create a group in My Groups first.</p>}
      <div className="checklist-scope-tabs"><button className={tab === "shared" ? "active" : ""} onClick={() => changeTab("shared")}>👥 Shared</button><button className={tab === "personal" ? "active" : ""} onClick={() => changeTab("personal")}>🔒 Personal</button></div>
      <p>{tab === "shared" ? "Visible to everyone in this group. Tasks can be completed once or by each member." : "Private to you, for this group trip only."}</p>
    </section>}
    {error && <p className="checklist-error" role="alert">{error}</p>}
    {!path ? <div className="empty-state"><span>🧳</span><p>{mode === "group" ? "Select a group to get started." : "Sign in to see your checklist."}</p></div> : loading ? <div className="empty-state"><span>🧳</span><p>Loading checklist...</p></div> : <main className="checklist-content">
      <section className="checklist-progress-card"><div className="progress-top"><div><p>{mode === "group" ? tab === "shared" ? "My Shared Preparation" : "My Private Preparation" : "Trip Preparation"}</p><h2>{doneCount} / {items.length}</h2></div><strong>{progress}%</strong></div>
        <div className="checklist-progress"><div className="checklist-progress-bar" style={{ width: `${progress}%` }} /></div><p className="progress-message">{items.length && progress === 100 ? "Everything is ready! 🎉" : "Keep going, you're almost ready!"}</p>
      </section>
      {showForm && <form className="checklist-form" onSubmit={save}><h2>{editingId ? "Edit Item" : "Add Checklist Item"}</h2><div className="checklist-form-grid"><label>Item<input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Passport" maxLength={200} required /></label>
        <label>Category<select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>{CATEGORIES.map(c => <option key={c}>{c}</option>)}</select></label></div>
        {mode === "group" && tab === "shared" && <fieldset className="checklist-completion-choice"><legend>Who needs to complete it?</legend><label><input type="radio" name="completionMode" checked={form.completionMode === "once"} onChange={() => setForm(f => ({ ...f, completionMode: "once" }))}/> Complete Once — one check for the group</label><label><input type="radio" name="completionMode" checked={form.completionMode === "everyone"} onChange={() => setForm(f => ({ ...f, completionMode: "everyone" }))}/> Everyone Must Complete — each member checks their own</label></fieldset>}
        {mode === "group" && tab === "shared" && editingId && (items.find(i => i.id === editingId)?.completionMode || "once") !== form.completionMode && <p className="checklist-mode-warning">Changing this type resets the task completion status for all members.</p>}
        <div className="form-buttons"><button type="button" onClick={reset}>Cancel</button><button type="submit" disabled={saving}>{saving ? "Saving..." : editingId ? "Save Changes" : "Add Item"}</button></div></form>}
      {CATEGORIES.map(category => { const subset = items.filter(i => i.category === category); if (!subset.length) return null; return <section className="checklist-category" key={category}><div className="category-title"><h2>{ICONS[category]} {category}</h2><span>{subset.filter(isDone).length} / {subset.length}</span></div>
        {subset.map(item => <div key={item.id} className={`checklist-item ${isDone(item) ? "completed" : ""}`}><button type="button" className="check-button" onClick={() => toggle(item)} aria-label={`Mark ${item.name} ${isDone(item) ? "incomplete" : "complete"}`}>{isDone(item) ? "✓" : ""}</button>
          <div className="checklist-item-info"><p>{item.name}</p><small>{isEveryone(item) ? `Everyone · ${members.filter(m => item.completedBy?.[m] === true).length}/${members.length} ready · ${isDone(item) ? "You are ready" : "Your turn"}` : mode === "group" && tab === "shared" ? "Complete Once · shared" : item.category}</small></div>
          <div className="checklist-item-actions"><button type="button" onClick={() => edit(item)}>Edit</button><button type="button" className="delete-button" onClick={() => remove(item)}>Delete</button></div></div>)}
      </section>; })}
      {!items.length && <div className="empty-state"><span>🧳</span><p>No checklist items yet.</p><small>Add something you need for this trip.</small></div>}
    </main>}
  </div>;
}
