
import { useEffect, useMemo, useState } from "react";

import {
  collection,
  doc,
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

const DEFAULT_EXPENSE = {
  date: "",
  category: "Food",
  description: "",
  plannedAmount: "",
  actualAmount: "",
};

function Expenses({
  trip,
  dashboardMode,
  onDashboardModeChange,
  selectedGroupId: sharedSelectedGroupId,
  onSelectedGroupChange,
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

  const budget =
    mode === "group"
      ? Number(selectedGroup?.tripSettings?.budget) || 0
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

    const tripRef = doc(db, "users", uid, "settings", "trip");

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
  }, [uid]);

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
    setError("");

    const expensesRef =
      mode === "group"
        ? collection(db, "groups", selectedGroupId, "expenses")
        : collection(db, "users", uid, "expenses");

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
  }, [uid, mode, selectedGroupId]);

  // Update the date when switching between trips.
  useEffect(() => {
    setNewExpense((current) => ({
      ...current,
      date: activeTrip?.startDate || "",
    }));
  }, [mode, selectedGroupId, activeTrip?.startDate]);

  const totalSpent = expenses.reduce(
    (total, expense) =>
      total + (Number(expense.actualAmount) || 0),
    0
  );

  const totalPlanned = expenses.reduce(
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
      );

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
          : collection(db, "users", uid, "expenses");

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
          : doc(db, "users", uid, "expenses", id);

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

      {mode === "group" && !selectedGroupId ? (
        <div className="empty-state">
          <span>👥</span>
          <p>Select or join a group to manage shared expenses.</p>
        </div>
      ) : (
        <>
          <section className="expense-summary">
            <div>
              <p>Budget</p>
              <h2>RM {money(budget)}</h2>
            </div>

            <div>
              <p>Spent</p>
              <h2>RM {money(totalSpent)}</h2>
            </div>

            <div className={remaining < 0 ? "over-budget" : ""}>
              <p>Remaining</p>
              <h2>RM {money(remaining)}</h2>
            </div>
          </section>

          <section className="expense-progress">
            <div className="progress-label">
              <span>{Math.round(usagePercentage)}% used</span>
              <span>
                RM {money(totalSpent)} / RM {money(budget)}
              </span>
            </div>

            <div className="progress">
              <div
                className={`progress-bar ${remaining < 0 ? "over-budget" : ""}`}
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
            <h2>
              {mode === "group" ? "Shared Expenses" : "Recent Expenses"}
            </h2>

            {expenses.length === 0 ? (
              <div className="empty-state">
                <span>💸</span>
                <p>No expenses yet.</p>
              </div>
            ) : (
              [...expenses]
                .sort((a, b) =>
                  (b.date || "").localeCompare(a.date || "")
                )
                .map((expense) => (
                  <div className="expense-card" key={expense.id}>
                    <div className="expense-icon">
                      {categoryIcon(expense.category)}
                    </div>

                    <div className="expense-info">
                      <h3>{expense.description}</h3>
                      <p>
                        {expense.category} · {formatDate(expense.date)}
                      </p>
                    </div>

                    <div className="expense-right">
                      <div>
                        <strong>
                          RM {money(expense.actualAmount)}
                        </strong>
                        <small>
                          Planned: RM {money(expense.plannedAmount)}
                        </small>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleEdit(expense)}
                      >
                        ✏️ Edit
                      </button>

                      <button
                        type="button"
                        onClick={() => handleDelete(expense.id)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))
            )}
          </section>

          <p className="expense-planned-total">
            Total planned expenses: RM {money(totalPlanned)}
          </p>
        </>
      )}
    </div>
  );
}

export default Expenses;