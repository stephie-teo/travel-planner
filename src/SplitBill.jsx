import { useEffect, useMemo, useState } from "react";
import { auth, db } from "./firebase";
import { addDoc, collection, deleteDoc, doc, getDocs, serverTimestamp, updateDoc } from "firebase/firestore";
import "./SplitBill.css";

const money = (cents) => `RM ${(cents / 100).toFixed(2)}`;
const today = () => new Date().toLocaleDateString("en-CA");

function allocateEqual(totalCents, ids) {
  const base = Math.floor(totalCents / ids.length);
  const remainder = totalCents % ids.length;
  return ids.map((uid, index) => ({ uid, amountCents: base + (index < remainder ? 1 : 0) }));
}

// Calculate net balances from saved integer-cent shares, including former members.
// Positive balance = should receive; negative = owes. No settlement writes in 2.3B.
function calculateBalances(records, currentMembers, settlements = []) {
  const net = new Map(currentMembers.map((uid) => [uid, 0]));
  let skipped = 0;
  for (const bill of records) {
    const amount = bill.amountCents;
    const shares = bill.shares;
    if (!Number.isSafeInteger(amount) || amount <= 0 || !Array.isArray(shares) ||
        !shares.length || typeof bill.payerId !== "string" || !bill.payerId ||
        !shares.every((s) => s && typeof s.uid === "string" && s.uid &&
          Number.isSafeInteger(s.amountCents) && s.amountCents >= 0) ||
        new Set(shares.map((s) => s.uid)).size !== shares.length ||
        shares.reduce((total, s) => total + s.amountCents, 0) !== amount) {
      skipped++;
      continue;
    }
    net.set(bill.payerId, (net.get(bill.payerId) || 0) + amount);
    for (const share of shares) net.set(share.uid, (net.get(share.uid) || 0) - share.amountCents);
  }
  let invalidSettlements = 0;
  for (const payment of settlements) {
    if (!payment || !Number.isSafeInteger(payment.amountCents) || payment.amountCents <= 0 ||
        typeof payment.fromId !== "string" || !payment.fromId ||
        typeof payment.toId !== "string" || !payment.toId || payment.fromId === payment.toId) {
      invalidSettlements++;
      continue;
    }
    // The person paying reduces their debt; the receiver reduces their credit.
    net.set(payment.fromId, (net.get(payment.fromId) || 0) + payment.amountCents);
    net.set(payment.toId, (net.get(payment.toId) || 0) - payment.amountCents);
  }
  const balances = [...net].map(([uid, amountCents]) => ({ uid, amountCents }))
    .sort((a, b) => b.amountCents - a.amountCents);
  const debtors = balances.filter((b) => b.amountCents < 0)
    .map((b) => ({ uid: b.uid, remaining: -b.amountCents }));
  const creditors = balances.filter((b) => b.amountCents > 0)
    .map((b) => ({ uid: b.uid, remaining: b.amountCents }));
  const transfers = [];
  let i = 0, j = 0;
  while (i < debtors.length && j < creditors.length) {
    const amountCents = Math.min(debtors[i].remaining, creditors[j].remaining);
    if (amountCents > 0) transfers.push({ from: debtors[i].uid, to: creditors[j].uid, amountCents });
    debtors[i].remaining -= amountCents;
    creditors[j].remaining -= amountCents;
    if (debtors[i].remaining === 0) i++;
    if (creditors[j].remaining === 0) j++;
  }
  return { balances, transfers, skipped, invalidSettlements };
}

export default function SplitBill({ group, view = "all" }) {
  const showExpenses = view !== "settlements";
  const showSettlements = view !== "expenses";
  const members = group?.memberIds || [];
  const [records, setRecords] = useState([]);
  const [linkedBillIds, setLinkedBillIds] = useState([]);
  const [settlements, setSettlements] = useState([]);
  const [paymentRequests, setPaymentRequests] = useState([]);
  const [proofUrl, setProofUrl] = useState("");
  const [proofBusy, setProofBusy] = useState(false);
  const [settling, setSettling] = useState(false);
  const [settleTarget, setSettleTarget] = useState(null);
  const [settleAmount, setSettleAmount] = useState("");
  const [editingPayment, setEditingPayment] = useState(null);
  const [editAmount, setEditAmount] = useState("");
  const [paymentBusy, setPaymentBusy] = useState(false);
  const [editingBill, setEditingBill] = useState(null);
  const [billBusy, setBillBusy] = useState(false);
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today);
  const [payerId, setPayerId] = useState(auth.currentUser?.uid || "");
  const [splitIds, setSplitIds] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const nameOf = (uid) => group?.memberNames?.[uid] || `Member ${uid.slice(-6)}`;

  useEffect(() => {
    setSplitIds([...members]);
    setPayerId(members.includes(auth.currentUser?.uid) ? auth.currentUser.uid : (members[0] || ""));
  }, [group?.id, group?.memberIds?.join("|")]);

  const refresh = async () => {
    if (!group?.id) return;
    setLoading(true);
    try {
      const [snap, settlementSnap, requestSnap, assignedSnap] = await Promise.all([
        getDocs(collection(db, "groups", group.id, "splitBills")).catch(err => { throw new Error(`splitBills: ${err.code || err.message}`); }),
        getDocs(collection(db, "groups", group.id, "settlements")).catch(err => { throw new Error(`settlements: ${err.code || err.message}`); }),
        getDocs(collection(db, "groups", group.id, "paymentRequests")).catch(err => { throw new Error(`paymentRequests: ${err.code || err.message}`); }),
        getDocs(collection(db, "groups", group.id, "assignedExpenses")).catch(err => { throw new Error(`assignedExpenses: ${err.code || err.message}`); }),
      ]);
      setLinkedBillIds(assignedSnap.docs.map(d => d.data().linkedBillId).filter(Boolean));
      setRecords(snap.docs.map((item) => ({ id: item.id, ...item.data() }))
        .sort((a, b) => (b.date || "").localeCompare(a.date || "")));
      setSettlements(settlementSnap.docs.map((item) => ({ id: item.id, ...item.data() }))
        .sort((a, b) => (b.date || "").localeCompare(a.date || "")));
      setPaymentRequests(requestSnap.docs.map(item => ({ id: item.id, ...item.data() }))
        .sort((a,b) => (b.date || "").localeCompare(a.date || "")));
      setError("");
    } catch (err) {
      setError(`Could not load split bills (${err.code || err.message}).`);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { refresh(); }, [group?.id]);

  const cents = useMemo(() => {
    if (!/^\d+(?:\.\d{1,2})?$/.test(amount.trim())) return null;
    const value = Math.round(Number(amount) * 100);
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }, [amount]);
  const allocations = cents !== null && splitIds.length ? allocateEqual(cents, splitIds) : [];
  const totalCents = records.reduce((sum, bill) => sum + (Number(bill.amountCents) || 0), 0);
  const { balances, transfers, skipped, invalidSettlements } = useMemo(
    () => calculateBalances(records, members, [...settlements, ...paymentRequests.filter(p => p.status === "confirmed")]),
    [records, settlements, paymentRequests, group?.id, group?.memberIds?.join("|")]
  );
  const canManageBill = (bill) => {
    const uid = auth.currentUser?.uid;
    return !!uid && members.includes(uid) &&
      (uid === group?.ownerId || uid === bill.createdBy);
  };
  const startEditBill = (bill) => {
    if (linkedBillIds.includes(bill.id)) { setError("This bill belongs to Individual Costs. Edit it there to keep both records in sync."); return; }
    setError(""); setSuccess("");
    setEditingBill(bill);
    setTitle(bill.title || "");
    setAmount((bill.amountCents / 100).toFixed(2));
    setDate(bill.date || today());
    setPayerId(bill.payerId || "");
    setSplitIds([...(bill.splitWith || [])]);
  };
  const cancelEditBill = () => {
    setEditingBill(null);
    setTitle(""); setAmount(""); setDate(today());
    setPayerId(members.includes(auth.currentUser?.uid) ? auth.currentUser.uid : (members[0] || ""));
    setSplitIds([...members]);
  };
  const deleteBill = async (bill) => {
    if (linkedBillIds.includes(bill.id)) { setError("This bill belongs to Individual Costs. Delete it there to keep both records in sync."); return; }
    if (billBusy || saving || !canManageBill(bill)) {
      setError("You do not have permission to delete this shared expense."); return;
    }
    if (!window.confirm(`Delete shared expense "${bill.title}" (${money(bill.amountCents)})?\n\nThis will recalculate balances, but any recorded payments will remain. Check Payment History after deleting.`)) return;
    setBillBusy(true); setError(""); setSuccess("");
    try {
      await deleteDoc(doc(db, "groups", group.id, "splitBills", bill.id));
      if (editingBill?.id === bill.id) cancelEditBill();
      await refresh();
      setSuccess("Shared expense deleted. Check balances and existing payments.");
    } catch (err) { setError(`Could not delete shared expense (${err.code || err.message}).`); }
    finally { setBillBusy(false); }
  };
  const canManagePayment = (payment) => {
    const uid = auth.currentUser?.uid;
    return !!uid && members.includes(uid) && (uid === group?.ownerId || uid === payment.fromId || uid === payment.toId);
  };
  const openSettlement = (transfer) => {
    setProofUrl("");
    setError(""); setSuccess("");
    setSettleTarget(transfer);
    setSettleAmount((transfer.amountCents / 100).toFixed(2));
  };
  const recordSettlement = async (event) => {
    event.preventDefault();
    if (!settleTarget || settling || !group?.id) return;
    const userId = auth.currentUser?.uid;
    if (userId !== settleTarget.from || !members.includes(settleTarget.to)) {
      setError("Only the person who owes money can submit payment proof."); return;
    }
    if (!/^\d+(?:\.\d{1,2})?$/.test(settleAmount.trim())) {
      setError("Enter a valid amount (up to 2 decimal places)."); return;
    }
    const amountCents = Math.round(Number(settleAmount) * 100);
    const live = calculateBalances(records, members, [...settlements, ...paymentRequests.filter(p => p.status === "confirmed")]).transfers.find(
      t => t.from === settleTarget.from && t.to === settleTarget.to
    );
    const pending = paymentRequests.filter(p => p.status === "pending" && p.fromId === settleTarget.from && p.toId === settleTarget.to)
      .reduce((sum,p) => sum + (Number(p.amountCents) || 0), 0);
    if (!Number.isSafeInteger(amountCents) || amountCents <= 0 || !live || amountCents > live.amountCents - pending) {
      setError("Amount exceeds the outstanding balance after pending submissions."); return;
    }
    const url = proofUrl.trim();
    if (!/^https:\/\/[^\s]+$/i.test(url) || url.length > 2000) {
      setError("Provide a valid HTTPS payment proof link (max 2000 characters)."); return;
    }
    setSettling(true); setError(""); setSuccess("");
    try {
      await addDoc(collection(db, "groups", group.id, "paymentRequests"), {
        fromId: live.from, toId: live.to, amountCents, currency: "MYR", date: today(),
        proofUrl: url, status: "pending", createdBy: userId, createdAt: serverTimestamp(),
      });
      setSettleTarget(null); setSettleAmount(""); setProofUrl("");
      await refresh();
      setSuccess("Payment proof submitted. The receiver must confirm it before balances change.");
    } catch (err) { setError(`Unable to submit payment proof (${err.code || err.message}).`); }
    finally { setSettling(false); }
  };

  const reviewPayment = async (payment, decision) => {
    if (proofBusy || auth.currentUser?.uid !== payment.toId || payment.status !== "pending") return;
    if (!window.confirm(`${decision === "confirmed" ? "Confirm receipt of" : "Reject"} ${money(payment.amountCents)} from ${nameOf(payment.fromId)}?`)) return;
    setProofBusy(true); setError(""); setSuccess("");
    try {
      await updateDoc(doc(db, "groups", group.id, "paymentRequests", payment.id), {
        status: decision, reviewedBy: auth.currentUser.uid, reviewedAt: serverTimestamp(),
      });
      await refresh();
      setSuccess(decision === "confirmed" ? "Payment confirmed. Balances updated." : "Payment rejected. Balance unchanged.");
    } catch (err) { setError(`Unable to review payment (${err.code || err.message}).`); }
    finally { setProofBusy(false); }
  };

  const cancelRequest = async (payment) => {
    if (proofBusy || payment.status !== "pending" || auth.currentUser?.uid !== payment.fromId) return;
    if (!window.confirm("Cancel this pending payment proof?")) return;
    setProofBusy(true); setError(""); setSuccess("");
    try {
      await deleteDoc(doc(db, "groups", group.id, "paymentRequests", payment.id));
      await refresh(); setSuccess("Pending payment proof cancelled.");
    } catch (err) { setError(`Unable to cancel (${err.code || err.message}).`); }
    finally { setProofBusy(false); }
  };

  const startEditPayment = (payment) => {
    setError(""); setSuccess(""); setSettleTarget(null);
    setEditingPayment(payment);
    setEditAmount((payment.amountCents / 100).toFixed(2));
  };
  const editPayment = async (event) => {
    event.preventDefault();
    const payment = editingPayment;
    if (!payment || paymentBusy || !canManagePayment(payment)) {
      setError("You do not have permission to edit this payment."); return;
    }
    if (!/^\d+(?:\.\d{1,2})?$/.test(editAmount.trim())) {
      setError("Enter a valid amount (up to 2 decimal places)."); return;
    }
    const newCents = Math.round(Number(editAmount) * 100);
    if (!Number.isSafeInteger(newCents) || newCents <= 0 || newCents > 100000000) {
      setError("Enter an amount between RM0.01 and RM1,000,000."); return;
    }
    if (newCents === payment.amountCents) { setEditingPayment(null); return; }
    if (!window.confirm(`Change this recorded payment from ${money(payment.amountCents)} to ${money(newCents)}?\n\nOnly do this to correct a payment record.`)) return;
    setPaymentBusy(true); setError(""); setSuccess("");
    try {
      await updateDoc(doc(db, "groups", group.id, "settlements", payment.id), {
        amountCents: newCents, updatedBy: auth.currentUser.uid, updatedAt: serverTimestamp(),
      });
      setEditingPayment(null);
      await refresh();
      setSuccess("Payment corrected. Balances recalculated.");
    } catch (err) { setError(`Could not edit payment (${err.code || err.message}).`); }
    finally { setPaymentBusy(false); }
  };
  const undoPayment = async (payment) => {
    if (paymentBusy || !canManagePayment(payment)) {
      setError("You do not have permission to undo this payment."); return;
    }
    if (!window.confirm(`Undo the recorded payment of ${money(payment.amountCents)} from ${nameOf(payment.fromId)} to ${nameOf(payment.toId)}?\n\nThis deletes the payment record and restores the outstanding balance. It does NOT reverse any real-world transfer.`)) return;
    setPaymentBusy(true); setError(""); setSuccess("");
    try {
      await deleteDoc(doc(db, "groups", group.id, "settlements", payment.id));
      if (editingPayment?.id === payment.id) setEditingPayment(null);
      await refresh();
      setSuccess("Payment record undone. Balances recalculated.");
    } catch (err) { setError(`Could not undo payment (${err.code || err.message}).`); }
    finally { setPaymentBusy(false); }
  };

  const save = async (event) => {
    event.preventDefault();
    if (saving || billBusy) return;
    setError(""); setSuccess("");
    if (!title.trim() || title.trim().length > 120) return setError("Enter a title (1–120 characters).");
    if (cents === null || cents > 100000000) return setError("Enter a valid amount between RM0.01 and RM1,000,000.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return setError("Choose a valid date.");
    if (!members.includes(payerId)) return setError("Choose a current group member as payer.");
    if (!splitIds.length || splitIds.some((id) => !members.includes(id))) return setError("Choose at least one current member to split with.");
    if (!auth.currentUser || !members.includes(auth.currentUser.uid)) return setError("You are no longer a group member.");
    if (editingBill && linkedBillIds.includes(editingBill.id)) return setError("Edit this linked bill in Individual Costs.");
    if (editingBill && !canManageBill(editingBill)) return setError("You do not have permission to edit this expense.");
    if (editingBill && !window.confirm(`Save changes to "${editingBill.title}"?\n\nBalances will be recalculated. Existing payment records will NOT be changed; please review them afterward.`)) return;
    setSaving(true);
    try {
      const payload = {
        title: title.trim(), date, amountCents: cents, currency: "MYR", payerId,
        splitWith: [...splitIds], shares: allocations,
      };
      if (editingBill) {
        await updateDoc(doc(db, "groups", group.id, "splitBills", editingBill.id), {
          ...payload, updatedBy: auth.currentUser.uid, updatedAt: serverTimestamp(),
        });
        setSuccess("Split bill updated. Please review existing payments.");
      } else {
        await addDoc(collection(db, "groups", group.id, "splitBills"), {
          ...payload, createdBy: auth.currentUser.uid, createdAt: serverTimestamp(),
        });
        setSuccess("Split bill added!");
      }
      cancelEditBill();
      await refresh();
    } catch (err) {
      setError(`Unable to save shared expense (${err.code || err.message}).`);
    } finally { setSaving(false); }
  };

  return <section id={showExpenses ? "shared-expense-manager" : "group-settlements"} className="group-form split-bill-section">
    <div className="split-bill-heading"><div><h2>{showExpenses ? "🤝 Split Bills" : "💸 Balances & Settle Up"}</h2><p>{showExpenses ? "Add, edit and review shared expenses here. Settle Up stays in My Groups." : "Review who owes whom, submit payment proof, and confirm received payments."}</p></div>{showExpenses && <strong>{money(totalCents)} total</strong>}</div>
    {showExpenses && <form onSubmit={save}>
      <h3>{editingBill ? `Edit Split Bill: ${editingBill.title}` : "Add Split Bill"}</h3>
      {editingBill && <p className="split-bill-muted">Editing a shared expense changes balances, but does not reverse or change any recorded settlements.</p>}
      <label htmlFor="split-title">Expense</label>
      <input id="split-title" maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Dinner" required />
      <div className="split-bill-grid">
        <div><label htmlFor="split-amount">Amount (RM)</label><input id="split-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="120.00" required /></div>
        <div><label htmlFor="split-date">Date</label><input id="split-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></div>
      </div>
      <label htmlFor="split-payer">Paid by</label>
      <select id="split-payer" value={payerId} onChange={(e) => setPayerId(e.target.value)} required>
        {members.map((uid) => <option key={uid} value={uid}>{nameOf(uid)}</option>)}
      </select>
      <fieldset className="split-bill-members"><legend>Split equally between</legend>
        {members.map((uid) => <label key={uid} className="split-bill-member"><input type="checkbox" checked={splitIds.includes(uid)} onChange={(e) => setSplitIds((prev) => e.target.checked ? [...prev, uid] : prev.filter((id) => id !== uid))}/><span>{nameOf(uid)}</span></label>)}
      </fieldset>
      {allocations.length > 0 && <div className="split-bill-preview"><strong>Split preview</strong>{allocations.map(({uid, amountCents}) => <div key={uid}><span>{nameOf(uid)}</span><b>{money(amountCents)}</b></div>)}</div>}
      {error && <p className="groups-error" role="alert">{error}</p>}
      {success && <p className="groups-message" role="status">{success}</p>}
      <div className="group-form-actions">
        {editingBill && <button className="cancel-group-button" type="button" disabled={saving} onClick={cancelEditBill}>Cancel Edit</button>}
        <button className="save-group-button" type="submit" disabled={saving || billBusy || !members.length}>{saving ? "Saving..." : editingBill ? "Save Expense Changes" : "+ Add Split Bill"}</button>
      </div>
    </form>}
    {showSettlements && <div className="split-proof-toolbar"><button type="button" className="cancel-group-button" onClick={refresh} disabled={loading}>{loading ? "Refreshing..." : "↻ Refresh balances & proofs"}</button></div>}
    {showSettlements && <div className="split-bill-balances" aria-label="Group balances">
      <div className="split-bill-balance-heading"><h3>⚖️ Group Balances</h3><span>Based on saved shared expenses</span></div>
      {skipped > 0 && <p className="groups-error" role="status">{skipped} invalid expense record(s) were excluded from balance calculations. Check the stored data.</p>}
      {invalidSettlements > 0 && <p className="groups-error" role="status">{invalidSettlements} invalid payment record(s) were excluded from balance calculations.</p>}
      <div className="split-bill-balance-list">
        {balances.map(({ uid, amountCents }) => (
          <div className="split-bill-balance-row" key={uid}>
            <span>{nameOf(uid)}{!members.includes(uid) ? " (former member)" : ""}</span>
            <strong className={amountCents > 0 ? "positive" : amountCents < 0 ? "negative" : "neutral"}>
              {amountCents > 0 ? `Gets back ${money(amountCents)}` : amountCents < 0 ? `Owes ${money(-amountCents)}` : "Settled RM 0.00"}
            </strong>
          </div>
        ))}
      </div>
      <h3>💸 Who Owes Who</h3>
      {transfers.length === 0 ? <p className="split-bill-muted">No outstanding balances.</p> : (
        <div className="split-bill-transfer-list">{transfers.map(({ from, to, amountCents }) => (
          <div className="split-bill-transfer" key={`${from}-${to}`}>
            <span><strong>{nameOf(from)}</strong> pays <strong>{nameOf(to)}</strong></span>
            <div className="split-bill-transfer-actions">
              <b>{money(amountCents)}</b>
              {members.includes(from) && members.includes(to) &&
                from === auth.currentUser?.uid &&
                <button type="button" className="split-bill-settle-btn"
                  disabled={settling} onClick={() => openSettlement({ from, to, amountCents })}>
                  Submit Proof
                </button>}
            </div>
          </div>
        ))}</div>
      )}
      <p className="split-bill-muted">Suggested transfers reflect recorded expenses and payments. Only confirmed proof submissions reduce the balance. Legacy recorded payments remain counted. Former members' balances remain visible, but this version records payments only between current members.</p>
      {settleTarget && <form className="split-bill-settle-form" onSubmit={recordSettlement}>
        <h3>Submit Payment Proof</h3>
        <p>{nameOf(settleTarget.from)} → {nameOf(settleTarget.to)}</p>
        <label htmlFor="split-settle-amount">Amount paid (RM)</label>
        <input id="split-settle-amount" inputMode="decimal" value={settleAmount}
          onChange={(e) => setSettleAmount(e.target.value)} required />
        <label htmlFor="split-proof-url">Payment proof link (HTTPS)</label>
        <input id="split-proof-url" type="url" value={proofUrl} onChange={e => setProofUrl(e.target.value)}
          placeholder="https://drive.google.com/..." maxLength={2000} required />
        <small>Share the screenshot with the receiver first. Pending requests do not reduce balances. Maximum suggested: {money(settleTarget.amountCents)}.</small>
        <div className="group-form-actions">
          <button type="button" className="cancel-group-button" disabled={settling}
            onClick={() => { setSettleTarget(null); setError(""); }}>Cancel</button>
          <button type="submit" className="save-group-button" disabled={settling}>
            {settling ? "Submitting..." : "Submit for Confirmation"}
          </button>
        </div>
      </form>}
    </div>}
    {showSettlements && <div className="split-bill-history"><h3>Payment Proof Requests</h3>
      <p className="split-bill-muted">Only the receiver can confirm or reject. Open proof links only from people you trust. Refresh to see new submissions.</p>
      {paymentRequests.length === 0 ? <p className="split-bill-muted">No payment proofs submitted yet.</p> :
        paymentRequests.map(payment => <article key={payment.id} className="split-bill-entry">
          <div><strong>{nameOf(payment.fromId)} → {nameOf(payment.toId)}</strong>
            <small>{payment.date} · <span className={`proof-status proof-${payment.status}`}>{payment.status}</span></small>
            {/^https:\/\/[^\s]+$/i.test(payment.proofUrl || "") && <a href={payment.proofUrl} target="_blank" rel="noopener noreferrer">View payment proof ↗</a>}
          </div>
          <div className="split-bill-payment-actions"><b>{money(payment.amountCents)}</b>
            {payment.status === "pending" && auth.currentUser?.uid === payment.toId && <div className="split-bill-payment-buttons">
              <button type="button" disabled={proofBusy} onClick={() => reviewPayment(payment, "confirmed")}>Confirm Received</button>
              <button type="button" className="split-bill-undo-btn" disabled={proofBusy} onClick={() => reviewPayment(payment, "rejected")}>Reject</button>
            </div>}
            {payment.status === "pending" && auth.currentUser?.uid === payment.fromId && <div className="split-bill-payment-buttons">
              <button type="button" disabled={proofBusy} onClick={() => cancelRequest(payment)}>Cancel Request</button>
            </div>}
          </div>
        </article>)}
    </div>}
    {showSettlements && <div className="split-bill-history"><h3>Legacy Payment History</h3>
      {settlements.length === 0 ? <p className="split-bill-muted">No payments recorded yet.</p> :
        settlements.map((payment) => <article key={payment.id} className="split-bill-entry">
          <div><strong>{nameOf(payment.fromId || "unknown")} paid {nameOf(payment.toId || "unknown")}</strong>
          <small>{payment.date} · Recorded by {nameOf(payment.recordedBy || "unknown")}</small></div>
          <div className="split-bill-payment-actions">
            <b>{money(payment.amountCents || 0)}</b>
            {canManagePayment(payment) && <div className="split-bill-payment-buttons">
              <button type="button" disabled={paymentBusy || settling} onClick={() => startEditPayment(payment)}>Edit</button>
              <button type="button" className="split-bill-undo-btn" disabled={paymentBusy || settling} onClick={() => undoPayment(payment)}>Undo</button>
            </div>}
          </div>
        </article>)}
      {editingPayment && <form className="split-bill-settle-form" onSubmit={editPayment}>
        <h3>Edit Payment</h3>
        <p>{nameOf(editingPayment.fromId)} → {nameOf(editingPayment.toId)}</p>
        <label htmlFor="split-edit-payment-amount">Correct amount (RM)</label>
        <input id="split-edit-payment-amount" inputMode="decimal" value={editAmount} onChange={(e) => setEditAmount(e.target.value)} required />
        <small>This changes the recorded amount only. It does not move money.</small>
        <div className="group-form-actions">
          <button type="button" className="cancel-group-button" disabled={paymentBusy} onClick={() => setEditingPayment(null)}>Cancel</button>
          <button type="submit" className="save-group-button" disabled={paymentBusy}>{paymentBusy ? "Saving..." : "Save Correction"}</button>
        </div>
      </form>}
    </div>}
    {showExpenses && <div className="split-bill-history"><h3>Shared expense history</h3>
      {loading ? <p>Loading...</p> : records.length === 0 ? <p>No shared expenses yet.</p> : records.map((bill) =>
        <article key={bill.id} className="split-bill-entry">
          <div><strong>{bill.title}</strong><small>{bill.date} · Paid by {nameOf(bill.payerId || "unknown")}</small>
            <small>Split between {(bill.splitWith || []).length} members</small>
          </div>
          <div className="split-bill-payment-actions">
            <b>{money(bill.amountCents || 0)}</b>
            {canManageBill(bill) && <div className="split-bill-payment-buttons">
              <button type="button" disabled={billBusy || saving} onClick={() => { startEditBill(bill); document.getElementById("split-title")?.focus(); }}>Edit</button>
              <button type="button" className="split-bill-undo-btn" disabled={billBusy || saving} onClick={() => deleteBill(bill)} disabled={linkedBillIds.includes(bill.id)}>Delete</button>
            </div>}
          </div>
        </article>)}
    </div>}
    <p className="split-bill-note">{showExpenses ? "Changes to shared expenses recalculate group balances but do not alter existing repayments. Check My Groups after corrections." : "Repayments change outstanding balances, not total travel spending. Review recorded payments before editing or undoing them."}</p>
  </section>;
}
