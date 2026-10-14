import { useEffect, useMemo, useState } from "react";
import { addDoc, collection, doc, writeBatch, serverTimestamp } from "firebase/firestore";
import { auth, db } from "./firebase";
import "./AssignedExpenses.css";

const fmt = cents => (cents / 100).toFixed(2);
const parseCents = value => {
  const text = String(value ?? "").trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return null;
  const result = Math.round(Number(text) * 100);
  return Number.isSafeInteger(result) && result >= 0 && result <= 100000000 ? result : null;
};
const today = () => new Date().toLocaleDateString("en-CA");

export default function AssignedExpenses({ group, currentUid, assignedExpenses = [], onError }) {
  const ids = group?.memberIds || [];
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(today());
  const [category, setCategory] = useState("Flight");
  const [mode, setMode] = useState("plan");
  const [payerId, setPayerId] = useState(currentUid || "");
  const [amounts, setAmounts] = useState({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [editing, setEditing] = useState(null);
  const nameOf = uid => group?.memberNames?.[uid] || group?.memberProfiles?.[uid]?.displayName || `Member ${uid.slice(-6)}`;
  useEffect(() => {
    setAmounts({}); setTitle(""); setEditing(null); setMode("plan"); setMessage("");
    setPayerId(ids.includes(currentUid) ? currentUid : (ids[0] || ""));
  }, [group?.id]);
  const allocations = useMemo(() => ids.filter(uid => amounts[uid]?.enabled).map(uid => ({
    uid, plannedCents: parseCents(amounts[uid]?.planned), actualCents: parseCents(amounts[uid]?.actual),
  })), [amounts, group?.id, group?.memberIds?.join("|")]);
  const totalPlanned = allocations.reduce((sum, a) => sum + (a.plannedCents || 0), 0);
  const totalActual = allocations.reduce((sum, a) => sum + (a.actualCents || 0), 0);
  const reset = () => { setEditing(null); setTitle(""); setDate(today()); setCategory("Flight"); setMode("plan"); setAmounts({}); setMessage(""); };
  const setRow = (uid, patch) => setAmounts(prev => ({ ...prev, [uid]: { ...(prev[uid] || {}), ...patch } }));
  const canManage = x => currentUid && (x.createdBy === currentUid || group?.ownerId === currentUid);
  const edit = x => {
    setEditing(x); setTitle(x.title); setDate(x.date); setCategory(x.category);
    setMode(x.linkedBillId ? "paid" : "plan"); setPayerId(x.payerId || currentUid);
    setAmounts(Object.fromEntries((x.allocations || []).map(a => [a.uid, { enabled: true, planned: fmt(a.plannedCents), actual: fmt(a.actualCents) }])));
    setMessage("");
  };
  const save = async ev => {
    ev.preventDefault(); onError?.(""); setMessage("");
    if (!currentUid || !ids.includes(currentUid)) return onError?.("You must be a group member.");
    if (!title.trim() || title.trim().length > 120 || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return onError?.("Enter a valid title and date.");
    if (!allocations.length || allocations.some(a => a.plannedCents === null || a.actualCents === null)) return onError?.("Select members and enter valid amounts (0.00 or more, up to 2 decimal places).");
    if (mode === "paid" && (!ids.includes(payerId) || totalActual <= 0 || allocations.some(a => a.actualCents <= 0))) return onError?.("Paid-on-behalf requires a payer and a positive actual amount for every selected member.");
    if (editing && !canManage(editing)) return onError?.("Only the creator or group owner can edit this record.");
    if (editing && ((mode === "paid") !== !!editing.linkedBillId) && !window.confirm("Changing payment mode will add or remove the linked Split Bill. Existing payment records will remain. Continue?")) return;
    if (editing && !window.confirm("Save changes? Existing settlements are not changed; please review balances afterward.")) return;
    setBusy(true);
    try {
      const batch = writeBatch(db);
      const assignedRef = editing ? doc(db, "groups", group.id, "assignedExpenses", editing.id) : doc(collection(db, "groups", group.id, "assignedExpenses"));
      const billRef = mode === "paid" ? (editing?.linkedBillId ? doc(db, "groups", group.id, "splitBills", editing.linkedBillId) : doc(collection(db, "groups", group.id, "splitBills"))) : null;
      const payload = { title: title.trim(), date, category, currency: "MYR", allocations,
        paymentMode: mode, payerId: mode === "paid" ? payerId : "", linkedBillId: billRef?.id || "" };
      if (editing) batch.update(assignedRef, { ...payload, updatedBy: currentUid, updatedAt: serverTimestamp() });
      else batch.set(assignedRef, { ...payload, createdBy: currentUid, createdAt: serverTimestamp() });
      if (billRef) {
        const bill = { title: title.trim(), date, amountCents: totalActual, currency: "MYR", payerId,
          splitWith: allocations.map(a => a.uid), shares: allocations.map(a => ({ uid: a.uid, amountCents: a.actualCents })) };
        if (editing?.linkedBillId) batch.update(billRef, { ...bill, updatedBy: currentUid, updatedAt: serverTimestamp() });
        else batch.set(billRef, { ...bill, createdBy: currentUid, createdAt: serverTimestamp() });
      }
      if (editing?.linkedBillId && mode === "plan") batch.delete(doc(db, "groups", group.id, "splitBills", editing.linkedBillId));
      await batch.commit(); reset(); setMessage(editing ? "Updated successfully. Review any existing settlements." : "Individual cost saved.");
    } catch (err) { onError?.(`Could not save assigned expense: ${err.code || err.message}`); }
    finally { setBusy(false); }
  };
  const remove = async x => {
    if (!canManage(x) || !window.confirm(`Delete ${x.title}? Linked Split Bill will also be deleted, but recorded settlements remain.`)) return;
    setBusy(true); onError?.("");
    try {
      const batch = writeBatch(db);
      batch.delete(doc(db, "groups", group.id, "assignedExpenses", x.id));
      if (x.linkedBillId) batch.delete(doc(db, "groups", group.id, "splitBills", x.linkedBillId));
      await batch.commit(); if (editing?.id === x.id) reset(); setMessage("Deleted. Review any existing settlements.");
    } catch (err) { onError?.(`Could not delete assigned expense: ${err.code || err.message}`); }
    finally { setBusy(false); }
  };
  return <section className="assigned-panel">
    <h2>✈️ Individual Costs</h2>
    <p>Assign different flight, hotel or insurance costs to members. Choose whether the cost is just for budgeting or has been paid on behalf of others.</p>
    <form onSubmit={save} className="assigned-form">
      <div className="assigned-fields"><label>Expense name<input required maxLength={120} value={title} onChange={e=>setTitle(e.target.value)} placeholder="Flight tickets" /></label>
      <label>Date<input type="date" required value={date} onChange={e=>setDate(e.target.value)} /></label>
      <label>Category<select value={category} onChange={e=>setCategory(e.target.value)}>{["Flight","Hotel","Insurance","Transport","Activities","Other"].map(x=><option key={x}>{x}</option>)}</select></label></div>
      <div className="assigned-mode"><label><input type="radio" checked={mode==="plan"} onChange={()=>setMode("plan")}/> Record costs only (no debt)</label>
      <label><input type="radio" checked={mode==="paid"} onChange={()=>setMode("paid")}/> Paid on behalf (create Split Bill)</label></div>
      {mode==="paid" && <label className="assigned-payer">Paid by <select value={payerId} onChange={e=>setPayerId(e.target.value)}>{ids.map(uid=><option key={uid} value={uid}>{nameOf(uid)}</option>)}</select></label>}
      <div className="assigned-members"><strong>Assign to members</strong><small>Planned and Actual amounts are per person, in RM. Use 0 for not yet spent.</small>
        {ids.map(uid=><div key={uid} className="assigned-member-row"><label><input type="checkbox" checked={!!amounts[uid]?.enabled} onChange={e=>setRow(uid,{enabled:e.target.checked,planned:amounts[uid]?.planned??"0",actual:amounts[uid]?.actual??"0"})}/>{nameOf(uid)}</label>
          <label>Planned<input aria-label={`Planned ${nameOf(uid)}`} disabled={!amounts[uid]?.enabled} type="number" min="0" step="0.01" value={amounts[uid]?.planned??""} onChange={e=>setRow(uid,{planned:e.target.value})}/></label>
          <label>Actual<input aria-label={`Actual ${nameOf(uid)}`} disabled={!amounts[uid]?.enabled} type="number" min="0" step="0.01" value={amounts[uid]?.actual??""} onChange={e=>setRow(uid,{actual:e.target.value})}/></label></div>)}
      </div>
      <p><strong>Total planned: RM {fmt(totalPlanned)}</strong> · <strong>Total actual: RM {fmt(totalActual)}</strong></p>
      <div className="assigned-actions"><button disabled={busy} type="submit">{busy?"Saving…":editing?"Save changes":"Add Individual Cost"}</button>{editing&&<button type="button" onClick={reset}>Cancel edit</button>}</div>
    </form>
    {message&&<p role="status" className="assigned-success">{message}</p>}
    <h3>Individual Cost History</h3>
    {!assignedExpenses.length&&<p>No assigned expenses yet.</p>}
    {[...assignedExpenses].sort((a,b)=>(b.date||"").localeCompare(a.date||"")).map(x=><div className="assigned-history" key={x.id}>
      <div><strong>{x.title}</strong><small>{x.date} · {x.category} · {x.linkedBillId?"Paid on behalf / linked to Split Bill":"Budget only / no debt"}</small>
      <small>{(x.allocations||[]).map(a=>`${nameOf(a.uid)}: RM ${fmt(a.actualCents||0)}`).join(" · ")}</small></div>
      <div><strong>RM {fmt((x.allocations||[]).reduce((s,a)=>s+(a.actualCents||0),0))}</strong>{canManage(x)&&<div className="assigned-actions"><button type="button" disabled={busy} onClick={()=>edit(x)}>Edit</button><button type="button" disabled={busy} onClick={()=>remove(x)}>Delete</button></div>}</div>
    </div>)}
    <p className="assigned-note">Paid-on-behalf records also appear in Split Bill and are counted only once. Edit linked bills here, not separately in Split Bill. Settlements are not automatically changed.</p>
  </section>;
}
