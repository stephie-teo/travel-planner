
import { useEffect, useState } from "react";
import "./Checklist.css";

import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  query,
  where,
  onSnapshot,
  serverTimestamp,
} from "firebase/firestore";

import { db, auth } from "./firebase";

const CATEGORIES = [
  "Documents",
  "Money",
  "Electronics",
  "Clothes",
  "Other",
];

const EMPTY_ITEM = {
  name: "",
  category: "Documents",
};

function Checklist({
  trip,
  dashboardMode,
  onDashboardModeChange,
  selectedGroupId: sharedSelectedGroupId,
  onSelectedGroupChange,
}) {
  const [localMode, setLocalMode] = useState("personal");

  const [groups, setGroups] = useState([]);
  const [groupsLoading, setGroupsLoading] = useState(true);
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

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [newItem, setNewItem] = useState({ ...EMPTY_ITEM });

  const uid = auth.currentUser?.uid;

  const selectedGroup = groups.find(
    (group) => group.id === selectedGroupId
  );

// Load groups and keep the group list updated.
useEffect(() => {
  if (!uid) {
    setGroups([]);
    setGroupsLoading(false);
    return;
  }

  setGroupsLoading(true);

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
      setGroupsLoading(false);
    },
    (err) => {
      console.error("Failed to load groups:", err);
      setError("Unable to load groups. Please try again.");
      setGroupsLoading(false);
    }
  );

  return unsubscribe;
}, [uid]);

// Preserve the Dashboard's selected group.
useEffect(() => {
  if (groupsLoading) return;

  const currentId =
    typeof sharedSelectedGroupId === "string"
      ? sharedSelectedGroupId
      : localSelectedGroupId;

  // Keep the current selection if it still exists.
  if (currentId && groups.some((group) => group.id === currentId)) {
    return;
  }

  // Choose the first group only when necessary.
  const firstGroupId = groups[0]?.id || "";

  if (typeof onSelectedGroupChange === "function") {
    onSelectedGroupChange(firstGroupId);
  } else {
    setLocalSelectedGroupId(firstGroupId);
  }
}, [
  groups,
  groupsLoading,
  sharedSelectedGroupId,
  localSelectedGroupId,
  onSelectedGroupChange,
]);

  // Listen to the selected checklist in real time.
  useEffect(() => {
    if (!uid) {
      setItems([]);
      setLoading(false);
      return;
    }

    if (mode === "group" && !selectedGroupId) {
      setItems([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");

    const checklistRef =
      mode === "group"
        ? collection(db, "groups", selectedGroupId, "checklist")
        : collection(db, "users", uid, "checklist");

    const unsubscribe = onSnapshot(
      checklistRef,
      (snapshot) => {
        const itemData = snapshot.docs.map((item) => ({
          id: item.id,
          ...item.data(),
        }));

        setItems(itemData);
        setLoading(false);
      },
      (err) => {
        console.error("Failed to load checklist:", err);
        setItems([]);
        setError(
          "Unable to load checklist. Please check your Firestore rules."
        );
        setLoading(false);
      }
    );

    return unsubscribe;
  }, [uid, mode, selectedGroupId]);

  const getItemRef = (id) => {
    if (mode === "group") {
      return doc(
        db,
        "groups",
        selectedGroupId,
        "checklist",
        id
      );
    }

    return doc(
      db,
      "users",
      uid,
      "checklist",
      id
    );
  };

  const resetForm = () => {
    setShowForm(false);
    setEditingId(null);
    setNewItem({ ...EMPTY_ITEM });
  };

  const handleChange = (event) => {
    const { name, value } = event.target;

    setNewItem((previous) => ({
      ...previous,
      [name]: value,
    }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!uid) {
      alert("You are not logged in.");
      return;
    }

    if (mode === "group" && !selectedGroupId) {
      alert("Please select a group first.");
      return;
    }

    if (!newItem.name.trim()) {
      alert("Please enter a checklist item.");
      return;
    }

    setSaving(true);

    try {
      const itemData = {
        name: newItem.name.trim(),
        category: newItem.category,
      };

      if (editingId !== null) {
        await updateDoc(
          getItemRef(editingId),
          {
            ...itemData,
            updatedAt: serverTimestamp(),
          }
        );
      } else {
        const checklistRef =
          mode === "group"
            ? collection(
                db,
                "groups",
                selectedGroupId,
                "checklist"
              )
            : collection(
                db,
                "users",
                uid,
                "checklist"
              );

        await addDoc(checklistRef, {
          ...itemData,
          completed: false,
          createdBy: uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }

      resetForm();
    } catch (err) {
      console.error("Failed to save checklist item:", err);
      alert(
        "Unable to save checklist item. Please check your Firestore rules."
      );
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (item) => {
    setEditingId(item.id);

    setNewItem({
      name: item.name || "",
      category: item.category || "Documents",
    });

    setShowForm(true);
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Are you sure you want to delete this item?")) {
      return;
    }

    if (!uid) {
      alert("You are not logged in.");
      return;
    }

    try {
      await deleteDoc(getItemRef(id));
    } catch (err) {
      console.error("Failed to delete checklist item:", err);
      alert(
        "Unable to delete checklist item. Please check your Firestore rules."
      );
    }
  };

  const handleToggle = async (item) => {
    if (!uid) {
      alert("You are not logged in.");
      return;
    }

    try {
      await updateDoc(getItemRef(item.id), {
        completed: !item.completed,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      console.error("Failed to update checklist item:", err);
      alert(
        "Unable to update checklist item. Please check your Firestore rules."
      );
    }
  };

  const completedCount = items.filter(
    (item) => item.completed
  ).length;

  const totalCount = items.length;

  const progress =
    totalCount === 0
      ? 0
      : Math.round((completedCount / totalCount) * 100);

  const getCategoryIcon = (category) => {
    if (category === "Documents") return "📄";
    if (category === "Money") return "💴";
    if (category === "Electronics") return "🔌";
    if (category === "Clothes") return "👕";
    return "📦";
  };

  if (loading) {
    return (
      <div className="checklist-page">
        <div className="empty-state">
          <span>🧳</span>
          <p>Loading checklist...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="checklist-page">
      <header className="checklist-header">
        <div>
          <p>
            ✈️{" "}
          {mode === "group"
            ? selectedGroup?.tripSettings?.name ||
              selectedGroup?.name ||
              "Group Trip"
            : trip?.name || "My Trip"}
          </p>
          <h1>Checklist</h1>
        </div>

        <button
          className="add-button"
          disabled={mode === "group" && !selectedGroupId}
          onClick={() => {
            if (showForm) {
              resetForm();
            } else {
              setEditingId(null);
              setNewItem({ ...EMPTY_ITEM });
              setShowForm(true);
            }
          }}
        >
          {showForm ? "Cancel" : "+ Add"}
        </button>
      </header>

      {/* PERSONAL / GROUP SWITCH */}
      <div className="checklist-mode-switch">
        <button
          type="button"
          className={mode === "personal" ? "active" : ""}
          onClick={() => {
            setMode("personal");
            resetForm();
          }}
        >
          Personal Checklist
        </button>

        <button
          type="button"
          className={mode === "group" ? "active" : ""}
          onClick={() => {
            setMode("group");
            resetForm();
          }}
        >
          Group Checklist
        </button>
      </div>

      {/* GROUP SELECTOR */}
      {mode === "group" && (
        <section className="checklist-group-selector">
          <label htmlFor="checklist-group">
            Select Group
          </label>

          {groups.length === 0 ? (
            <p>
              You haven't joined any groups yet. Create or join
              a group on the Groups page first.
            </p>
          ) : (
            <select
              id="checklist-group"
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
              Shared checklist for {selectedGroup.tripSettings?.name || selectedGroup.name}
            </p>
          )}
        </section>
      )}

      {error && (
        <p className="checklist-error">{error}</p>
      )}

      {mode === "group" && !selectedGroupId ? (
        <div className="empty-state">
          <span>👥</span>
          <p>Select or join a group to manage its checklist.</p>
        </div>
      ) : (
        <main className="checklist-content">
          <section className="checklist-progress-card">
            <div className="progress-top">
              <div>
                <p>
                  {mode === "group"
                    ? "Group Trip Preparation"
                    : "Trip Preparation"}
                </p>
                <h2>
                  {completedCount} / {totalCount}
                </h2>
              </div>

              <strong>{progress}%</strong>
            </div>

            <div className="checklist-progress">
              <div
                className="checklist-progress-bar"
                style={{ width: `${progress}%` }}
              />
            </div>

            <p className="progress-message">
              {progress === 100
                ? "Everything is ready! 🎉"
                : "Keep going, you're almost ready!"}
            </p>
          </section>

          {showForm && (
            <form
              className="checklist-form"
              onSubmit={handleSubmit}
            >
              <h2>
                {editingId !== null
                  ? "Edit Item"
                  : "Add Checklist Item"}
              </h2>
              <div className="checklist-form-grid">

              <label>
                Item
                <input
                  type="text"
                  name="name"
                  placeholder="e.g. Japan SIM card"
                  value={newItem.name}
                  onChange={handleChange}
                  required
                />
              </label>

              <label>
                Category
                <select
                  name="category"
                  value={newItem.category}
                  onChange={handleChange}
                >
                  {CATEGORIES.map((category) => (
                    <option value={category} key={category}>
                      {category}
                    </option>
                  ))}
                </select>
              </label>
            </div>
              <div className="form-buttons">
                <button
                  type="button"
                  onClick={resetForm}
                >
                  Cancel
                </button>

                <button type="submit" disabled={saving}>
                  {saving
                    ? "Saving..."
                    : editingId !== null
                    ? "Save Changes"
                    : "Add Item"}
                </button>
              </div>
            </form>
          )}

          <section className="checklist-section">
            {CATEGORIES.map((category) => {
              const categoryItems = items.filter(
                (item) => item.category === category
              );

              if (categoryItems.length === 0) {
                return null;
              }

              const categoryCompleted = categoryItems.filter(
                (item) => item.completed
              ).length;

              return (
                <div
                  className="checklist-category"
                  key={category}
                >
                  <div className="category-title">
                    <h2>
                      {getCategoryIcon(category)} {category}
                    </h2>

                    <span>
                      {categoryCompleted} / {categoryItems.length}
                    </span>
                  </div>

                  {categoryItems.map((item) => (
                    <div
                      className={`checklist-item ${
                        item.completed ? "completed" : ""
                      }`}
                      key={item.id}
                    >
                      <button
                        type="button"
                        className="check-button"
                        aria-label={
                          item.completed
                            ? `Mark ${item.name} incomplete`
                            : `Mark ${item.name} complete`
                        }
                        onClick={() => handleToggle(item)}
                      >
                        {item.completed ? "✓" : ""}
                      </button>

                      <div className="checklist-item-info">
                        <p>{item.name}</p>
                        <small>{item.category}</small>
                      </div>

                      <div className="checklist-item-actions">
                        <button
                          type="button"
                          onClick={() => handleEdit(item)}
                        >
                          Edit
                        </button>

                        <button
                          type="button"
                          className="delete-button"
                          onClick={() => handleDelete(item.id)}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              );
            })}
          </section>

          {items.length === 0 && (
            <div className="empty-state">
              <span>🧳</span>
              <p>Your checklist is empty.</p>
              <small>
                Add something you need for the trip.
              </small>
            </div>
          )}
        </main>
      )}
    </div>
  );
}

export default Checklist;