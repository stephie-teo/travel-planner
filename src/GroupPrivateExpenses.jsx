import { useEffect, useState } from "react";
import { addDoc, collection, deleteDoc, doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { db } from "./firebase";
import "./GroupPrivateExpenses.css";

const EMPTY = { description: "", category: "Shopping", date: new Date().toLocaleDateString("en-CA"), plannedAmount: "", actualAmount: "" };
const money = n => Number(n || 0).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const validAmount = v => /^\d+(?:\.\d{1,2})?$/.test(String(v));
export default function GroupPrivateExpenses({ groupId, uid, expenses = [], onError }) {
  const [form, setForm] = useState(EMPTY);
  const [editingId, setEditingId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [open, setOpen] = useState(false);
  useEffect(() => { setForm({ ...EMPTY }); setEditingId(null); setNotice(""); setOpen(false); }, [groupId, uid]);
  const ref = () => collection(db, "users", uid, "groupPrivateExpenses", groupId, "items");
  const save = async e => {
    e.preventDefault(); onError?.(""); setNotice("");
    if (!uid || !groupId) return;
    if (!form.description.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(form.date) || !validAmount(form.plannedAmount) || !validAmount(form.actualAmount)) {
      onError?.("Enter a description, date and valid non-negative amounts (up to two decimals)."); return;
    }
    const planned = Number(form.plannedAmount), actual = Number(form.actualAmount);
    if (!Number.isFinite(planned) || !Number.isFinite(actual) || planned > 1000000 || actual > 1000000) { onError?.("Amount exceeds the allowed limit."); return; }
    setBusy(true);
    try {
      const payload = { description: form.description.trim().slice(0,120), date: form.date, category: form.category,
        plannedAmount: planned, actualAmount: actual, currency: "MYR", updatedAt: serverTimestamp() };
      if (editingId) await updateDoc(doc(ref(), editingId), payload);
      else await addDoc(ref(), { ...payload, createdBy: uid, createdAt: serverTimestamp() });
      setForm({ ...EMPTY }); setEditingId(null); setOpen(false); setNotice("Private expense saved.");
    } catch (err) { onError?.(`Could not save private expense: ${err.code || err.message}`); }
    finally { setBusy(false); }
  };
  const remove = async item => {
    if (!window.confirm(`Delete private expense "${item.description}"?`)) return;
    setBusy(true); onError?.("");
    try { await deleteDoc(doc(ref(), item.id)); if (editingId === item.id) { setEditingId(null); setOpen(false); } setNotice("Private expense deleted."); }
    catch (err) { onError?.(`Could not delete private expense: ${err.code || err.message}`); }
    finally { setBusy(false); }
  };
  return <section className="private-expenses-panel">
    <div className="private-panel-heading"><div><span className="private-eyebrow">ONLY VISIBLE TO YOU</span><h2>🔒 My Private Expenses</h2><p>Shopping, makeup, souvenirs and other personal purchases. These do not create Split Bill debts.</p></div>
      <button type="button" onClick={() => { setOpen(x=>!x); setEditingId(null); setForm({ ...EMPTY }); }}>{open ? "Close" : "+ Add Private"}</button></div>
    {open && <form className="private-form" onSubmit={save}>
      <label className="private-wide">Description<input required maxLength={120} value={form.description} placeholder="e.g. Skincare at Don Quijote" onChange={e=>setForm(s=>({...s,description:e.target.value}))}/></label>
      <label>Category<select value={form.category} onChange={e=>setForm(s=>({...s,category:e.target.value}))}>{["Shopping","Food","Transport","Attraction","Hotel","Others"].map(c=><option key={c}>{c}</option>)}</select></label>
      <label>Date<input type="date" required value={form.date} onChange={e=>setForm(s=>({...s,date:e.target.value}))}/></label>
      <label>Planned (RM)<input type="number" required min="0" step="0.01" value={form.plannedAmount} onChange={e=>setForm(s=>({...s,plannedAmount:e.target.value}))} placeholder="0.00"/></label>
      <label>Actual (RM)<input type="number" required min="0" step="0.01" value={form.actualAmount} onChange={e=>setForm(s=>({...s,actualAmount:e.target.value}))} placeholder="0.00"/></label>
      <div className="private-form-actions"><button disabled={busy} type="submit">{busy ? "Saving…" : editingId ? "Save Changes" : "Save Private Expense"}</button><button type="button" onClick={()=>{setOpen(false);setEditingId(null);}}>Cancel</button></div>
    </form>}
    {notice && <p role="status" className="private-notice">{notice}</p>}
    <div className="private-history-header"><h3>My Purchases</h3><span>{expenses.length} records</span></div>
    {!expenses.length && <p className="private-empty">No private expenses yet. Your personal purchases will appear here.</p>}
    {[...expenses].sort((a,b)=>(b.date||"").localeCompare(a.date||"")).map(item=><div className="private-record" key={item.id}>
      <div><strong>{item.description}</strong><small>{item.category} · {item.date}</small><small>Planned RM {money(item.plannedAmount)}</small></div>
      <div className="private-record-end"><strong>RM {money(item.actualAmount)}</strong><div><button disabled={busy} type="button" onClick={()=>{setEditingId(item.id);setForm({description:item.description,category:item.category,date:item.date,plannedAmount:String(item.plannedAmount),actualAmount:String(item.actualAmount)});setOpen(true);}}>Edit</button><button disabled={busy} type="button" onClick={()=>remove(item)}>Delete</button></div></div>
    </div>)}
    <p className="private-disclaimer">Private purchases count toward your personal spending overview, not the shared group budget. Your group members cannot access these records under the user-only Firestore rules.</p>
  </section>;
}
