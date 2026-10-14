import { useEffect, useMemo, useState } from "react";
import { addDoc, collection, doc, updateDoc, serverTimestamp } from "firebase/firestore";
import { auth, db } from "./firebase";

const categories = ["Food", "Flight", "Hotel", "Insurance", "Transport", "Shopping", "Activities", "Other"];
const toCents = value => {
  const s = String(value).trim();
  if (!/^(?:\d+)(?:\.\d{1,2})?$/.test(s)) return null;
  const [whole, decimal = ""] = s.split(".");
  const cents = Number(whole) * 100 + Number(decimal.padEnd(2, "0"));
  return Number.isSafeInteger(cents) && cents >= 0 && cents <= 100000000 ? cents : null;
};
const money = cents => (cents / 100).toFixed(2);
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; };

export default function SharedExpenseForm({ group, onSaved, editing = null, onCancel }) {
  const members = useMemo(() => group?.memberIds || [], [group?.memberIds]);
  const uid = auth.currentUser?.uid;
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(today());
  const [category, setCategory] = useState("Hotel");
  const [amount, setAmount] = useState("");
  const [status, setStatus] = useState("paid");
  const [payerId, setPayerId] = useState(uid || "");
  const [splitType, setSplitType] = useState("equal");
  const [participants, setParticipants] = useState([]);
  const [custom, setCustom] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  useEffect(() => {
    if (!editing) { setTitle(""); setDate(today()); setCategory("Hotel"); setAmount(""); setStatus("paid"); setSplitType("equal"); setCustom({}); return; }
    const record = editing.expense;
    const isPaid = editing.kind === "split";
    const allocations = isPaid ? (record.shares || []).map(x => ({uid:x.uid, amountCents:x.amountCents})) : (record.allocations || []).map(x => ({uid:x.uid, amountCents:x.plannedCents || x.actualCents || 0}));
    const sum = allocations.reduce((n,x) => n + x.amountCents, 0);
    setTitle(record.title || ""); setDate(record.date || today()); setCategory(record.category || "Other"); setAmount(money(isPaid ? record.amountCents : sum));
    setStatus(isPaid ? "paid" : "plan"); setPayerId(record.payerId || uid || ""); setSplitType("custom");
    setParticipants(allocations.map(x => x.uid)); setCustom(Object.fromEntries(allocations.map(x => [x.uid, money(x.amountCents)])));
    setError(""); setSuccess("");
  }, [editing?.expense?.id, editing?.kind, group?.id]);
  useEffect(() => { if (editing) return; setParticipants([...members]); setPayerId(members.includes(uid) ? uid : members[0] || ""); setCustom({}); }, [group?.id, members.join("|"), uid, !!editing]);
  const nameOf = id => group?.memberNames?.[id] || group?.memberProfiles?.[id]?.displayName || (id === uid ? "You" : `Member ${id.slice(-6)}`);
  const cents = toCents(amount);
  const shares = useMemo(() => {
    if (!participants.length || cents === null) return [];
    if (splitType === "equal") {
      const base = Math.floor(cents / participants.length), remainder = cents % participants.length;
      return participants.map((id, i) => ({ uid: id, amountCents: base + (i < remainder ? 1 : 0) }));
    }
    return participants.map(id => ({ uid: id, amountCents: toCents(custom[id] ?? "") }));
  }, [participants, cents, splitType, custom]);
  const validShares = shares.length > 0 && shares.every(s => s.amountCents !== null && (status === "plan" || s.amountCents > 0)) && shares.reduce((s,x)=>s+x.amountCents,0) === cents;
  const submit = async e => {
    e.preventDefault(); setError(""); setSuccess("");
    if (!uid || !members.includes(uid)) return setError("Please sign in as a group member.");
    if (!title.trim() || title.trim().length > 120 || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return setError("Enter a valid name and date.");
    if (cents === null || cents <= 0) return setError("Enter an amount between RM 0.01 and RM 1,000,000.");
    if (!participants.length || participants.some(id => !members.includes(id)) || !validShares) return setError("Shares must add up exactly to the total amount. For Paid expenses, every selected person needs a positive share.");
    if (status === "paid" && !members.includes(payerId)) return setError("Select who paid.");
    setBusy(true);
    try {
      if (editing) {
        const record = editing.expense;
        if (editing.kind === "split") {
          await updateDoc(doc(db, "groups", group.id, "splitBills", record.id), {
            title: title.trim(), date, category, amountCents: cents, payerId,
            splitWith: participants, shares, updatedBy: uid, updatedAt: serverTimestamp(),
          });
        } else {
          await updateDoc(doc(db, "groups", group.id, "assignedExpenses", record.id), {
            title: title.trim(), date, category,
            allocations: shares.map(x => ({uid:x.uid, plannedCents:x.amountCents, actualCents:0})),
            updatedBy: uid, updatedAt: serverTimestamp(),
          });
        }
      } else if (status === "paid") {
        await addDoc(collection(db, "groups", group.id, "splitBills"), {
          title: title.trim(), date, category, amountCents: cents, currency: "MYR", payerId,
          splitWith: participants, shares, createdBy: uid, createdAt: serverTimestamp(),
        });
      } else {
        await addDoc(collection(db, "groups", group.id, "assignedExpenses"), {
          title: title.trim(), date, category, currency: "MYR",
          allocations: shares.map(s => ({ uid: s.uid, plannedCents: s.amountCents, actualCents: 0 })),
          paymentMode: "plan", payerId: "", linkedBillId: "", createdBy: uid, createdAt: serverTimestamp(),
        });
      }
      if (!editing) { setTitle(""); setAmount(""); setCustom({}); } setSuccess(editing ? "Expense updated. Review any existing settlements." : status === "paid" ? "Shared expense saved. Balances updated." : "Planned expense saved. No debt created yet."); onSaved?.();
    } catch (err) { console.error(err); setError(`Could not save: ${err.code || err.message}`); }
    finally { setBusy(false); }
  };
  return <form className="unified-shared-form" onSubmit={submit}>
    <div className="unified-form-heading"><h3>{editing ? "Edit Shared Expense" : "+ Add Shared Expense"}</h3><p>One form for hotel, food, transport and group plans.</p></div>
    <div className="unified-form-grid">
      <label>Expense Name<input required maxLength={120} value={title} onChange={e=>setTitle(e.target.value)} placeholder="e.g. Tokyo Hotel" /></label>
      <label>Date<input required type="date" value={date} onChange={e=>setDate(e.target.value)} /></label>
      <label>Category<select value={category} onChange={e=>setCategory(e.target.value)}>{categories.map(x=><option key={x}>{x}</option>)}</select></label>
      <label>Total Amount (RM)<input required type="number" min="0.01" max="1000000" step="0.01" value={amount} onChange={e=>setAmount(e.target.value)} placeholder="600.00" /></label>
      <label>Status<select value={status} disabled={!!editing} onChange={e=>setStatus(e.target.value)}><option value="paid">Paid</option><option value="plan">Planned</option></select></label>
      {status === "paid" && <label>Paid By<select value={payerId} onChange={e=>setPayerId(e.target.value)}>{members.map(id=><option key={id} value={id}>{nameOf(id)}</option>)}</select></label>}
      <label>Split Method<select value={splitType} onChange={e=>setSplitType(e.target.value)}><option value="equal">Equal Split</option><option value="custom">Custom Amount</option></select></label>
    </div>
    <fieldset className="unified-participants"><legend>Participants & Shares</legend>{members.map(id=>{
      const checked = participants.includes(id); const share = shares.find(s=>s.uid===id);
      return <div className="unified-person" key={id}><label><input type="checkbox" checked={checked} onChange={e=>setParticipants(current=>e.target.checked?[...current,id]:current.filter(x=>x!==id))}/><span>{nameOf(id)}</span></label>{checked && (splitType === "equal" ? <strong>RM {share?.amountCents == null ? "—" : money(share.amountCents)}</strong> : <input type="number" min="0" step="0.01" placeholder="RM" aria-label={`Share for ${nameOf(id)}`} value={custom[id] ?? ""} onChange={e=>setCustom(c=>({...c,[id]:e.target.value}))}/>)}</div>;
    })}</fieldset>
    {status === "plan" && <p className="unified-note">Planned expenses count toward planned budget only. No debts are created for planned expenses.</p>}
    {status === "paid" && <p className="unified-note">Paid expenses count once toward Group Spending. Debts are calculated automatically from the payer and shares.</p>}
    {splitType === "custom" && cents !== null && <p className="unified-note">Allocated RM {money(shares.reduce((sum,s)=>sum+(s.amountCents || 0),0))} / RM {money(cents)}</p>}
    {error && <p className="unified-error" role="alert">{error}</p>}{success && <p className="unified-success" role="status">{success}</p>}
    <div className="shared-expense-actions" style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "12px" }}>
      <button type="submit" disabled={busy || !validShares}>
        {busy ? "Saving..." : editing ? "Save Changes" : "Save Shared Expense"}
      </button>
      {editing && (
        <button type="button" className="shared-expense-cancel-btn" style={{ marginLeft: 0 }} onClick={onCancel}>
          Cancel
        </button>
      )}
    </div>
  </form>;
}
