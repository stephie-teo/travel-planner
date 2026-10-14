

import { useEffect, useMemo, useState } from "react";



import {

  collection,

  doc,
  getDoc,

  onSnapshot,

  addDoc,

  updateDoc,

  deleteDoc,

  query,

  where,

  serverTimestamp,

} from "firebase/firestore";



import { db, auth } from "./firebase";

import "./Expenses.css";
import SharedExpenseForm from "./SharedExpenseForm";
import GroupPrivateExpenses from "./GroupPrivateExpenses";



const DEFAULT_EXPENSE = {

  date: "",

  category: "Food",

  description: "",

  plannedAmount: "",

  actualAmount: "",

};



function Expenses({

  trip,
  selectedTripId = null,

  dashboardMode,

  onDashboardModeChange,

  selectedGroupId: sharedSelectedGroupId,

  onSelectedGroupChange,
  onOpenGroups,

}) {

  const [localMode, setLocalMode] = useState("personal");



  const [groups, setGroups] = useState([]);

  const [localSelectedGroupId, setLocalSelectedGroupId] = useState("");



  const mode =

    dashboardMode === "personal" || dashboardMode === "group"

      ? dashboardMode

      : localMode;



  const setMode = (nextMode) => {

    if (typeof onDashboardModeChange === "function") {

      onDashboardModeChange(nextMode);

    } else {

      setLocalMode(nextMode);

    }

  };



  const selectedGroupId =

    typeof sharedSelectedGroupId === "string"

      ? sharedSelectedGroupId

      : localSelectedGroupId;



  const setSelectedGroupId = (groupId) => {

    if (typeof onSelectedGroupChange === "function") {

      onSelectedGroupChange(groupId);

    } else {

      setLocalSelectedGroupId(groupId);

    }

  };



  const [expenses, setExpenses] = useState([]);
  const [splitBills, setSplitBills] = useState([]);
  const [assignedExpenses, setAssignedExpenses] = useState([]);
  const [privateExpenses, setPrivateExpenses] = useState([]);
  const [privateError, setPrivateError] = useState("");
  const [assignedError, setAssignedError] = useState("");
  const [splitLoading, setSplitLoading] = useState(false);
  const [splitError, setSplitError] = useState("");
  const [expenseFilter, setExpenseFilter] = useState("all");
  const [editingShared, setEditingShared] = useState(null);
  const [sharedActionError, setSharedActionError] = useState("");

  const [personalBudget, setPersonalBudget] = useState(0);



  const [showForm, setShowForm] = useState(false);

  const [editingId, setEditingId] = useState(null);

  const [saving, setSaving] = useState(false);

  const [loading, setLoading] = useState(true);

  const [error, setError] = useState("");



  const [newExpense, setNewExpense] = useState({

    ...DEFAULT_EXPENSE,

    date: trip?.startDate || "",

  });



  const uid = auth.currentUser?.uid;



  const selectedGroup = useMemo(

    () => groups.find((group) => group.id === selectedGroupId),

    [groups, selectedGroupId]

  );



  // Resolve member display names for the Expenses -> SplitBill entry point.
  const [memberNames, setMemberNames] = useState({});
  useEffect(() => {
    let active = true;
    setMemberNames({});
    if (mode !== "group" || !selectedGroup?.id || !uid) return () => { active = false; };
    const ids = selectedGroup.memberIds || [];
    Promise.all(ids.map(async (memberId) => {
      try {
        const snapshot = await getDoc(doc(db, "userProfiles", memberId));
        const profile = snapshot.exists() ? snapshot.data() : {};
        const name = String(profile.displayName || profile.email?.split("@")[0] ||
          selectedGroup.memberProfiles?.[memberId]?.displayName ||
          selectedGroup.memberProfiles?.[memberId]?.name || "").trim();
        return [memberId, name || (memberId === uid ? (auth.currentUser?.displayName || auth.currentUser?.email?.split("@")[0]) : "") || `Member ${memberId.slice(-6)}`];
      } catch (err) {
        console.warn("Could not read group member profile", memberId, err);
        return [memberId, `Member ${memberId.slice(-6)}`];
      }
    })).then(entries => { if (active) setMemberNames(Object.fromEntries(entries)); });
    return () => { active = false; };
  }, [mode, selectedGroup?.id, selectedGroup?.memberIds?.join("|"), uid]);
  const splitBillGroup = useMemo(() => selectedGroup ? {
    ...selectedGroup, memberNames: { ...(selectedGroup.memberNames || {}), ...memberNames }
  } : null, [selectedGroup, memberNames]);

  const budgetPerPerson = Number(selectedGroup?.tripSettings?.budget) || 0;
  const groupMemberCount = selectedGroup?.memberIds?.length || 0;
  const budget =

    mode === "group"

      ? budgetPerPerson * groupMemberCount

      : personalBudget;



  const activeTrip =

    mode === "group"

      ? selectedGroup?.tripSettings

      : trip;



  // Keep the group list updated in real time.

  useEffect(() => {

    if (!uid) {

      setGroups([]);

      setLoading(false);

      return;

    }



    const groupsQuery = query(

      collection(db, "groups"),

      where("memberIds", "array-contains", uid)

    );



    const unsubscribe = onSnapshot(

      groupsQuery,

      (snapshot) => {

        const groupData = snapshot.docs.map((item) => ({

          id: item.id,

          ...item.data(),

        }));



        setGroups(groupData);



        setSelectedGroupId((currentId) => {

          if (groupData.some((group) => group.id === currentId)) {

            return currentId;

          }



          return groupData[0]?.id || "";

        });

      },

      (err) => {

        console.error("Failed to load groups:", err);

        setError("Unable to load groups. Please try again.");

      }

    );



    return unsubscribe;

  }, [uid]);



  // Listen to the personal trip budget.

  useEffect(() => {

    if (!uid) return;



    setPersonalBudget(0);
    const tripRef = selectedTripId
    ? doc(db, "users", uid, "trips", selectedTripId)
    : doc(db, "users", uid, "settings", "trip");



    const unsubscribe = onSnapshot(

      tripRef,

      (snapshot) => {

        if (snapshot.exists()) {

          setPersonalBudget(Number(snapshot.data().budget) || 0);

        } else {

          setPersonalBudget(0);

        }

      },

      (err) => {

        console.error("Failed to load personal budget:", err);

      }

    );



    return unsubscribe;

  }, [uid, selectedTripId]);



  // Clear stale records and edit state whenever the selected source changes.
  useEffect(() => {
    setExpenses([]);
    setLoading(true);
    setShowForm(false);
    setEditingId(null);
    setSaving(false);
    setError("");
    setNewExpense({ ...DEFAULT_EXPENSE, date: activeTrip?.startDate || "" });
  }, [mode, selectedGroupId, selectedTripId]);

  // Listen to expenses in the currently selected mode.

  useEffect(() => {

    if (!uid) {

      setExpenses([]);

      setLoading(false);

      return;

    }



    if (mode === "group" && !selectedGroupId) {

      setExpenses([]);

      setLoading(false);

      return;

    }



    setLoading(true);
    setExpenses([]);

    setError("");



    const expensesRef =

      mode === "group"

        ? collection(db, "groups", selectedGroupId, "expenses")

        : collection(db, "users", uid, ...(selectedTripId ? ["trips", selectedTripId] : []), "expenses");



    const unsubscribe = onSnapshot(

      expensesRef,

      (snapshot) => {

        const expenseData = snapshot.docs.map((item) => ({

          id: item.id,

          ...item.data(),

        }));



        setExpenses(expenseData);

        setLoading(false);

      },

      (err) => {

        console.error("Failed to load expenses:", err);

        setError(

          "Unable to load expenses. Please check your permissions and try again."

        );

        setExpenses([]);

        setLoading(false);

      }

    );



    return unsubscribe;

  }, [uid, mode, selectedGroupId, selectedTripId]);



  // Split bills are read from their existing source of truth, never copied into expenses.
  useEffect(() => {
    setSplitBills([]);
    setSplitError("");
    setExpenseFilter("all");
    setEditingShared(null);
    if (mode !== "group" || !selectedGroupId || !uid) {
      setSplitLoading(false);
      return;
    }
    setSplitLoading(true);
    const unsubscribe = onSnapshot(
      collection(db, "groups", selectedGroupId, "splitBills"),
      (snapshot) => {
        setSplitBills(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
        setSplitLoading(false);
      },
      (err) => {
        console.error("Failed to load shared split bills:", err);
        setSplitBills([]);
        setSplitError("Unable to load Split Bill expenses. Totals may be incomplete.");
        setSplitLoading(false);
      }
    );
    return unsubscribe;
  }, [uid, mode, selectedGroupId]);

  // Assigned expense documents are not duplicated in Split Bill. When paid on behalf
  // of members, the linked split bill is the actual-spend source of truth.
  useEffect(() => {
    setAssignedExpenses([]);
    setAssignedError("");
    if (mode !== "group" || !selectedGroupId || !uid) return;
    return onSnapshot(collection(db, "groups", selectedGroupId, "assignedExpenses"),
      snap => setAssignedExpenses(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      err => { console.error(err); setAssignedError("Unable to load assigned expenses; totals may be incomplete."); });
  }, [mode, selectedGroupId, uid]);

  // Group private expenses live only under the signed-in user's own document.
  // No group member can read another member's private purchases via group paths.
  useEffect(() => {
    setPrivateExpenses([]);
    setPrivateError("");
    if (mode !== "group" || !selectedGroupId || !uid) return;
    return onSnapshot(
      collection(db, "users", uid, "groupPrivateExpenses", selectedGroupId, "items"),
      snapshot => setPrivateExpenses(snapshot.docs.map(item => ({ id: item.id, ...item.data() }))),
      err => { console.error("Private expense listener:", err); setPrivateError("Unable to load your private expenses. Check Firestore Rules."); }
    );
  }, [mode, selectedGroupId, uid]);

  // Update the date when switching between trips.

  useEffect(() => {

    setNewExpense((current) => ({

      ...current,

      date: activeTrip?.startDate || "",

    }));

  }, [mode, selectedGroupId, selectedTripId, activeTrip?.startDate]);



  const otherSpent = expenses.reduce(

    (total, expense) =>

      total + (Number(expense.actualAmount) || 0),

    0

  );



  const splitTotalCents = mode === "group"
    ? splitBills.reduce((sum, bill) => sum + (Number.isSafeInteger(bill.amountCents) && bill.amountCents > 0 ? bill.amountCents : 0), 0)
    : 0;
  const mySplitShareCents = mode === "group"
    ? splitBills.reduce((sum, bill) => {
        if (!Array.isArray(bill.shares)) return sum;
        const own = bill.shares.find((share) => share.uid === uid);
        return sum + (Number.isSafeInteger(own?.amountCents) && own.amountCents >= 0 ? own.amountCents : 0);
      }, 0)
    : 0;
  // Group budget counts each transaction once. Settlements are transfers, not new expenses.
  const assignedUnpaidActualCents = mode === "group"
    ? assignedExpenses.filter(x => !x.linkedBillId).reduce((sum, x) => sum + (x.allocations || []).reduce((n, a) => n + (Number(a.actualCents) || 0), 0), 0) : 0;
  const myAssignedActualCents = mode === "group"
    ? assignedExpenses.filter(x => !x.linkedBillId).reduce((sum, x) => sum + (Number(x.allocations?.find(a => a.uid === uid)?.actualCents) || 0), 0) : 0;
  const myAssignedPlannedCents = mode === "group"
    ? assignedExpenses.reduce((sum, x) => sum + (Number(x.allocations?.find(a => a.uid === uid)?.plannedCents) || 0), 0) : 0;
  const privateSpent = mode === "group" ? privateExpenses.reduce((s,x)=>s+(Number(x.actualAmount)||0),0) : 0;
  const privatePlanned = mode === "group" ? privateExpenses.reduce((s,x)=>s+(Number(x.plannedAmount)||0),0) : 0;
  const myKnownSpent = privateSpent + (myAssignedActualCents + mySplitShareCents) / 100;
  const totalSpent = otherSpent + splitTotalCents / 100 + assignedUnpaidActualCents / 100; // shared total excludes private purchases
  const mySharedSpent = (myAssignedActualCents + mySplitShareCents) / 100;
  const myRemainingBudget = budgetPerPerson - mySharedSpent;
  const deleteSharedExpense = async (kind, expense) => {
    if (kind === "split" && assignedExpenses.some(x => x.linkedBillId === expense.id)) { setSharedActionError("This older expense is linked to another record. It cannot be deleted here safely."); return; }
    if (!window.confirm(`Delete "${expense.title}"? This changes everyone’s spending and balances. Recorded repayments will not be deleted.`)) return;
    setSharedActionError("");
    try {
      const source = kind === "split" ? "splitBills" : "assignedExpenses";
      await deleteDoc(doc(db, "groups", selectedGroupId, source, expense.id));
      if (editingShared?.expense?.id === expense.id) setEditingShared(null);
    } catch (err) { setSharedActionError(`Unable to delete: ${err.code || err.message}`); }
  };
  const editSharedExpense = (kind, expense) => {
    if (kind === "split" && assignedExpenses.some(x => x.linkedBillId === expense.id)) { setSharedActionError("This older expense is linked to another record. It cannot be edited here safely."); return; }
    setEditingShared({kind, expense});
    document.getElementById("shared-expense-manager")?.scrollIntoView({behavior:"smooth", block:"start"});
  };
  const filteredPrivate = mode === "group" && (expenseFilter === "all" || expenseFilter === "private") ? privateExpenses : [];
  const filteredExpenses = mode !== "group" || expenseFilter === "all"
    ? expenses : expenseFilter === "other" ? expenses : [];
  const filteredSplitBills = mode === "group" ? splitBills : [];
  const filteredPlans = mode === "group" ? assignedExpenses.filter(x => !x.linkedBillId) : [];
  const combinedHistory = [
    ...filteredExpenses.map((expense) => ({ kind: "other", expense })),
    ...filteredPrivate.map((expense) => ({ kind: "private", expense })),
    ...filteredSplitBills.map((expense) => ({ kind: "split", expense })),
    ...filteredPlans.map((expense) => ({ kind: "plan", expense })),
  ].sort((a, b) => (b.expense.date || "").localeCompare(a.expense.date || ""));

  // Planned assigned costs are counted once; paid assigned costs are already in splitBills.
  const assignedPlanned = mode === "group" ? assignedExpenses
    .filter(item => !item.linkedBillId)
    .reduce((sum, item) => sum + (item.allocations || []).reduce((n, a) => n + (Number(a.plannedCents) || 0), 0) / 100, 0) : 0;
  const totalPlanned = assignedPlanned + expenses.reduce(

    (total, expense) =>

      total + (Number(expense.plannedAmount) || 0),

    0

  );



  const remaining = budget - totalSpent;



  const usagePercentage =

    budget > 0 ? (totalSpent / budget) * 100 : 0;



  const categoryTotal = (category) =>

    expenses

      .filter((expense) => expense.category === category)

      .reduce(

        (total, expense) =>

          total + (Number(expense.actualAmount) || 0),

        0
      ) + (mode === "group" ? splitBills.filter(x => (x.category || "Other") === category)
        .reduce((n,x) => n + (Number(x.amountCents) || 0)/100, 0) : 0);

  const handleChange = (event) => {

    const { name, value } = event.target;



    setNewExpense((current) => ({

      ...current,

      [name]: value,

    }));

  };



  const resetForm = () => {

    setNewExpense({

      ...DEFAULT_EXPENSE,

      date: activeTrip?.startDate || "",

    });

    setEditingId(null);

    setShowForm(false);

  };



  const handleAdd = async (event) => {

    event.preventDefault();



    if (!uid) {

      alert("You are not logged in.");

      return;

    }



    if (mode === "group" && !selectedGroupId) {

      alert("Please select a group first.");

      return;

    }



    if (

      !newExpense.description.trim() ||

      newExpense.plannedAmount === "" ||

      Number(newExpense.plannedAmount) < 0 ||

      (newExpense.actualAmount !== "" &&

        Number(newExpense.actualAmount) < 0)

    ) {

      alert("Please enter a description and valid amounts.");

      return;

    }



    setSaving(true);



    try {

      const expensesRef =

        mode === "group"

          ? collection(db, "groups", selectedGroupId, "expenses")

          : collection(db, "users", uid, ...(selectedTripId ? ["trips", selectedTripId] : []), "expenses");



      const expenseData = {

        date: newExpense.date,

        category: newExpense.category,

        description: newExpense.description.trim(),

        plannedAmount: Number(newExpense.plannedAmount),

        actualAmount: Number(newExpense.actualAmount) || 0,

        updatedAt: serverTimestamp(),

      };



      if (editingId) {

        await updateDoc(

          doc(expensesRef, editingId),

          expenseData

        );

      } else {

        await addDoc(expensesRef, {

          ...expenseData,

          createdBy: uid,

          createdAt: serverTimestamp(),

        });

      }



      resetForm();

    } catch (err) {

      console.error("Failed to save expense:", err);

      alert(

        "Unable to save expense. Please check your Firestore rules."

      );

    } finally {

      setSaving(false);

    }

  };



  const handleEdit = (expense) => {

    setNewExpense({

      date: expense.date || "",

      category: expense.category || "Food",

      description: expense.description || "",

      plannedAmount: expense.plannedAmount ?? "",

      actualAmount: expense.actualAmount ?? "",

    });



    setEditingId(expense.id);

    setShowForm(true);

  };



  const handleDelete = async (id) => {

    if (!window.confirm("Delete this expense?")) return;

    if (!uid) return;



    try {

      const expenseRef =

        mode === "group"

          ? doc(db, "groups", selectedGroupId, "expenses", id)

          : doc(db, "users", uid, ...(selectedTripId ? ["trips", selectedTripId] : []), "expenses", id);



      await deleteDoc(expenseRef);



      if (editingId === id) {

        resetForm();

      }

    } catch (err) {

      console.error("Failed to delete expense:", err);

      alert(

        "Unable to delete expense. Please check your Firestore rules."

      );

    }

  };



  const formatDate = (date) => {

    if (!date) return "No date";



    const d = new Date(`${date}T00:00:00`);



    if (Number.isNaN(d.getTime())) return date;



    return d.toLocaleDateString("en-GB", {

      day: "2-digit",

      month: "short",

      year: "numeric",

    });

  };



  const categoryIcon = (category) => {

    const icons = {

      Food: "🍜",

      Transport: "🚆",

      Shopping: "🛍️",

      Hotel: "🏨",

      Attraction: "🎡",

      Others: "📦",

    };



    return icons[category] || "📦";

  };



  const money = (amount) =>

    Number(amount || 0).toLocaleString("en-MY", {

      minimumFractionDigits: 2,

      maximumFractionDigits: 2,

    });



  if (loading) {

    return (

      <div className="expenses-page">

        <div className="empty-state">

          <span>💰</span>

          <p>Loading expenses...</p>

        </div>

      </div>

    );

  }



  return (

    <div className="expenses-page">

      <header className="expenses-header">

        <div>

          <p>

            ✈️{" "}

           {mode === "group"

            ? selectedGroup?.tripSettings?.name ||

              selectedGroup?.name ||

              "Group Trip"

            : activeTrip?.name || "My Trip"}

          </p>

          <h1>Expenses</h1>

        </div>



        <button

          className="add-button"

          disabled={mode === "group" && !selectedGroupId}

          onClick={() => {

            if (showForm) {

              resetForm();

            } else {

              setEditingId(null);

              setNewExpense({

                ...DEFAULT_EXPENSE,

                date: activeTrip?.startDate || "",

              });

              setShowForm(true);

            }

          }}

        >

          {showForm ? "Cancel" : "+ Add"}

        </button>

      </header>



      {/* MODE SWITCH */}

      <div className="expense-mode-switch">

        <button

          type="button"

          className={mode === "personal" ? "active" : ""}

          onClick={() => {

            setMode("personal");

            resetForm();

          }}

        >

          Personal Expenses

        </button>



        <button

          type="button"

          className={mode === "group" ? "active" : ""}

          onClick={() => {

            setMode("group");

            resetForm();

          }}

        >

          Group Expenses

        </button>

      </div>



      {mode === "group" && (

        <section className="expense-group-selector">

          <label htmlFor="expense-group">Select Group</label>



          {groups.length === 0 ? (

            <p>

              You haven't joined any groups yet. Create or join a

              group on the Groups page first.

            </p>

          ) : (

            <select

              id="expense-group"

              value={selectedGroupId}

              onChange={(event) => {

                setSelectedGroupId(event.target.value);

                resetForm();

              }}

            >

              {groups.map((group) => (

                <option key={group.id} value={group.id}>

                  {group.tripSettings?.name || group.name}

                </option>

              ))}

            </select>

          )}



          {selectedGroup && (

            <p>

              Shared budget: RM {money(budget)}

              {selectedGroup.tripSettings?.destination

                ? ` · ${selectedGroup.tripSettings.destination}`

                : ""}

            </p>

          )}

        </section>

      )}



      {error && <p className="expenses-error">{error}</p>}
      {splitError && <p className="expenses-error">{splitError}</p>}
      {mode === "group" && splitLoading && <p className="expense-sync-note">Loading Split Bill records…</p>}



      {mode === "group" && !selectedGroupId ? (

        <div className="empty-state">

          <span>👥</span>

          <p>Select or join a group to manage shared expenses.</p>

        </div>

      ) : (

        <>

          {mode === "group" && selectedGroup && (
            <section className="shared-entry-shell" id="shared-expense-manager" aria-label="Shared expenses">
              <h2>🤝 Shared Expenses</h2>
              <p>One simple form for all shared expenses. Each person has their own budget.</p>
              <SharedExpenseForm group={splitBillGroup} editing={editingShared} onCancel={() => setEditingShared(null)} onSaved={() => setEditingShared(null)} />
              {sharedActionError && <p className="expenses-error">{sharedActionError}</p>}
            </section>
          )}
          {mode === "group" && assignedError && <p className="expenses-error">{assignedError}</p>}
          {mode === "group" && selectedGroup && <GroupPrivateExpenses
            groupId={selectedGroupId} uid={uid} expenses={privateExpenses} onError={setPrivateError}
          />}
          {mode === "group" && privateError && <p className="expenses-error">{privateError}</p>}
          {mode === "group" && (
            <section className="personal-group-overview" aria-label="Shared expense information">
              <div><span>Budget per person</span><strong>RM {money(budgetPerPerson)}</strong><small>Each member has the same budget</small></div>
              <div><span>Total group budget ({groupMemberCount} members)</span><strong>RM {money(budget)}</strong><small>Per-person budget × group members</small></div>
              <div><span>My shared spending</span><strong>RM {money(mySharedSpent)}</strong><small>My share, regardless of who paid · Remaining RM {money(myRemainingBudget)}</small></div>
              <div><span>Shared spending</span><strong>RM {money(totalSpent)}</strong><small>Each group expense counted once; repayments are not expenses</small></div>
              <div><span>My private spending</span><strong>RM {money(privateSpent)}</strong><small>Visible only to you; excluded from the group budget</small></div>
            </section>
          )}
          <section className="expense-summary">

            <div>

              <p>Budget</p>

              <h2>RM {money(budget)}</h2>

            </div>



            <div>

              <p>Spent</p>

              <h2>RM {money(totalSpent)}</h2>

            </div>



            <div>

              <p>Remaining</p>

              <h2 className={remaining < 0 ? "is-negative" : ""}>RM {money(remaining)}</h2>

            </div>

          </section>



          {mode === "group" && (
            <section className="expense-split-overview" aria-label="Group spending breakdown">
              <div><span>Other group expenses</span><strong>RM {money(otherSpent)}</strong></div>
              <div><span>Shared split expenses</span><strong>RM {money(splitTotalCents / 100)}</strong></div>
              <div><span>My share of split expenses</span><strong>RM {money(mySplitShareCents / 100)}</strong></div>
              <p>Group spending counts shared expenses once. Your spending uses your allocated shares; legacy unallocated expenses are excluded from personal shares. Repayments are not expenses.</p>
            </section>
          )}

          <section className="expense-progress">

            <div className="progress-label">

              <span>{Math.round(usagePercentage)}% used</span>

              <span>

                RM {money(totalSpent)} / RM {money(budget)}

              </span>

            </div>



            <div className="progress">

              <div

                className={`progress-bar ${usagePercentage > 100 ? "over-budget" : ""}`}

                style={{

                  width: `${Math.min(Math.max(usagePercentage, 0), 100)}%`,

                }}

              />

            </div>

          </section>



          {showForm && (

            <form className="expense-form" onSubmit={handleAdd}>

              <h2>{editingId ? "Edit Expense" : "Add Expense"}</h2>



              <div className="expense-form-grid">
              <label>

                Date

                <input

                  type="date"

                  name="date"

                  value={newExpense.date}

                  onChange={handleChange}

                />

              </label>



              <label>

                Category

                <select

                  name="category"

                  value={newExpense.category}

                  onChange={handleChange}

                >

                  <option value="Food">🍜 Food</option>

                  <option value="Transport">🚆 Transport</option>

                  <option value="Shopping">🛍️ Shopping</option>

                  <option value="Hotel">🏨 Hotel</option>

                  <option value="Attraction">🎡 Attraction</option>

                  <option value="Others">📦 Others</option>

                </select>

              </label>



              <label className="expense-field-wide">

                Description

                <input

                  type="text"

                  name="description"

                  placeholder="e.g. Ramen dinner"

                  value={newExpense.description}

                  onChange={handleChange}

                  required

                />

              </label>



              <label>

                Planned Amount (RM)

                <input

                  type="number"

                  name="plannedAmount"

                  min="0"

                  step="0.01"

                  placeholder="0.00"

                  value={newExpense.plannedAmount}

                  onChange={handleChange}

                  required

                />

              </label>



              <label>

                Actual Amount (RM)

                <input

                  type="number"

                  name="actualAmount"

                  min="0"

                  step="0.01"

                  placeholder="Leave empty if not spent yet"

                  value={newExpense.actualAmount}

                  onChange={handleChange}

                />

              </label>



              </div>

              <div className="form-buttons">

                <button type="button" onClick={resetForm}>

                  Cancel

                </button>



                <button type="submit" disabled={saving}>

                  {saving

                    ? "Saving..."

                    : editingId

                    ? "Update Expense"

                    : "Save Expense"}

                </button>

              </div>

            </form>

          )}



          <section className="category-section">

            <h2>Spending by Category</h2>



            <div className="category-grid">

              {["Food", "Transport", "Shopping", "Hotel"].map(

                (category) => (

                  <div className="category-card" key={category}>

                    <span>{categoryIcon(category)}</span>

                    <p>{category}</p>

                    <strong>RM {money(categoryTotal(category))}</strong>

                  </div>

                )

              )}

            </div>

          </section>



          <section className="expense-list">
            <h2>{mode === "group" ? "Expense History" : "Recent Expenses"}</h2>

            {combinedHistory.length === 0 ? (
              <div className="empty-state"><span>💸</span><p>No expenses in this view.</p></div>
            ) : combinedHistory.map(({ kind, expense }) => kind === "split" ? (
              <div className="expense-card" key={`split-${expense.id}`}>
                <div className="expense-icon">🤝</div>
                <div className="expense-info">
                  <h3>{expense.title || "Shared expense"} <span className="expense-type-badge">Paid</span></h3>
                  <p>{formatDate(expense.date)} · Split between {expense.splitWith?.length || expense.shares?.length || 0} members</p>
                  <p>Your share: RM {money((expense.shares?.find((share) => share.uid === uid)?.amountCents || 0) / 100)}</p>
                </div>
                <div className="expense-right">
                  <strong>RM {money((expense.amountCents || 0) / 100)}</strong>
                  <small>Full group expense</small>
                  <button type="button" onClick={() => editSharedExpense("split", expense)}>✏️ Edit</button>
                  <button type="button" onClick={() => deleteSharedExpense("split", expense)}>Delete</button>
                </div>
              </div>
            ) : kind === "plan" ? (
              <div className="expense-card" key={`plan-${expense.id}`}>
                <div className="expense-icon">🗓️</div>
                <div className="expense-info"><h3>{expense.title || "Planned expense"} <span className="expense-type-badge">Planned</span></h3>
                  <p>{expense.category} · {formatDate(expense.date)}</p></div>
                <div className="expense-right">
                  <strong>RM {money((expense.allocations || []).reduce((n,a)=>n+(Number(a.plannedCents)||0),0)/100)}</strong>
                  <button type="button" onClick={() => editSharedExpense("plan", expense)}>✏️ Edit</button>
                  <button type="button" onClick={() => deleteSharedExpense("plan", expense)}>Delete</button>
                </div>
              </div>
            ) : kind === "private" ? (
              <div className="expense-card" key={`private-${expense.id}`}>
                <div className="expense-icon">🔒</div>
                <div className="expense-info"><h3>{expense.description} <span className="expense-type-badge">Private</span></h3>
                  <p>{expense.category} · {formatDate(expense.date)}</p></div>
                <div className="expense-right"><strong>RM {money(expense.actualAmount)}</strong><small>Planned: RM {money(expense.plannedAmount)}</small>
                  <small>Manage in My Private Expenses above</small></div>
              </div>
            ) : (
              <div className="expense-card" key={`other-${expense.id}`}>
                <div className="expense-icon">{categoryIcon(expense.category)}</div>
                <div className="expense-info">
                  <h3>{expense.description} {mode === "group" && <span className="expense-type-badge expense-type-other">Shared</span>}</h3>
                  <p>{expense.category} · {formatDate(expense.date)}</p>
                </div>
                <div className="expense-right">
                  <strong>RM {money(expense.actualAmount)}</strong>
                  <small>Planned: RM {money(expense.plannedAmount)}</small>
                  <button type="button" onClick={() => handleEdit(expense)}>✏️ Edit</button>
                  <button type="button" onClick={() => handleDelete(expense.id)}>Delete</button>
                </div>
              </div>
            ))}
          </section>

          <p className="expense-planned-total">

            Planned shared expenses: RM {money(totalPlanned)}

          </p>

        </>

      )}

    </div>

  );

}



export default Expenses;