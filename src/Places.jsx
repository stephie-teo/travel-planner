
import { useEffect, useState } from "react";
import "./Places.css";

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

const EMPTY_PLACE = {
  date: "",
  name: "",
  category: "Sightseeing",
  location: "",
  mapsUrl: "",
};

const CATEGORIES = [
  "Sightseeing",
  "Food",
  "Shopping",
  "Cafe",
];

function Places({
  trip,
  dashboardMode,
  onDashboardModeChange,
  selectedGroupId: sharedSelectedGroupId,
  onSelectedGroupChange,
}) {
  const [places, setPlaces] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

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

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);

  const user = auth.currentUser;

  const selectedGroup = groups.find(
    (group) => group.id === selectedGroupId
  );

  const defaultDate =
    mode === "group"
      ? selectedGroup?.tripSettings?.startDate || trip?.startDate || ""
      : trip?.startDate || "";

  const [newPlace, setNewPlace] = useState({
    ...EMPTY_PLACE,
    date: trip?.startDate || "",
  });

// Load groups the current user belongs to.
useEffect(() => {
  const currentUser = auth.currentUser;

  if (!currentUser) {
    setGroups([]);
    setGroupsLoading(false);
    return;
  }

  setGroupsLoading(true);

  const groupsQuery = query(
    collection(db, "groups"),
    where("memberIds", "array-contains", currentUser.uid)
  );

  const unsubscribe = onSnapshot(
    groupsQuery,
    (snapshot) => {
      const loadedGroups = snapshot.docs.map((item) => ({
        id: item.id,
        ...item.data(),
      }));

      setGroups(loadedGroups);
      setGroupsLoading(false);
    },
    (err) => {
      console.error("Failed to load groups:", err);
      setError("Unable to load groups. Please check Firestore Rules.");
      setGroupsLoading(false);
    }
  );

  return unsubscribe;
}, []);

// Preserve the Dashboard's selected group.
// Wait until the group list has finished loading before validating it.
useEffect(() => {
  if (groupsLoading) return;

  const currentId =
    typeof sharedSelectedGroupId === "string"
      ? sharedSelectedGroupId
      : localSelectedGroupId;

  if (currentId && groups.some((group) => group.id === currentId)) {
    return;
  }

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

  // Subscribe to personal or group places in real time.
  useEffect(() => {
    if (!auth.currentUser) {
      setPlaces([]);
      setLoading(false);
      return;
    }

    if (mode === "group" && !selectedGroupId) {
      setPlaces([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");

    const placesRef =
      mode === "group"
        ? collection(db, "groups", selectedGroupId, "places")
        : collection(
            db,
            "users",
            auth.currentUser.uid,
            "places"
          );

    const unsubscribe = onSnapshot(
      placesRef,
      (snapshot) => {
        const loadedPlaces = snapshot.docs.map((item) => ({
          id: item.id,
          ...item.data(),
        }));

        setPlaces(loadedPlaces);
        setLoading(false);
      },
      (err) => {
        console.error("Failed to load places:", err);
        setError(
          "Unable to load places. Please check your Firestore Rules."
        );
        setPlaces([]);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [mode, selectedGroupId]);

  const resetForm = () => {
    setNewPlace({
      ...EMPTY_PLACE,
      date: defaultDate,
    });
    setEditingId(null);
    setShowForm(false);
  };

  const handleChange = (e) => {
    const { name, value } = e.target;

    setNewPlace((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleModeChange = (nextMode) => {
    setMode(nextMode);
    setError("");
    setShowForm(false);
    setEditingId(null);
    setNewPlace({
      ...EMPTY_PLACE,
      date: trip?.startDate || "",
    });
  };

  const handleGroupChange = (e) => {
    setSelectedGroupId(e.target.value);
    setError("");
    setShowForm(false);
    setEditingId(null);
  };

  const handleAdd = async (e) => {
    e.preventDefault();

    if (!newPlace.name.trim() || !newPlace.location.trim()) {
      setError("Please enter the place name and location.");
      return;
    }

    if (!auth.currentUser) {
      setError("You are not logged in.");
      return;
    }

    if (mode === "group" && !selectedGroupId) {
      setError("Please select a group first.");
      return;
    }

    setSaving(true);
    setError("");

    try {
      const placesRef =
        mode === "group"
          ? collection(db, "groups", selectedGroupId, "places")
          : collection(
              db,
              "users",
              auth.currentUser.uid,
              "places"
            );

      const placeData = {
        date: newPlace.date,
        name: newPlace.name.trim(),
        category: newPlace.category,
        location: newPlace.location.trim(),
        mapsUrl: newPlace.mapsUrl.trim(),
      };

      if (editingId !== null) {
        const placeRef = doc(
          db,
          mode === "group" ? "groups" : "users",
          mode === "group"
            ? selectedGroupId
            : auth.currentUser.uid,
          mode === "group" ? "places" : "places",
          editingId
        );

        await updateDoc(placeRef, {
          ...placeData,
          updatedAt: serverTimestamp(),
        });
      } else {
        await addDoc(placesRef, {
          ...placeData,
          visited: false,
          createdBy: auth.currentUser.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }

      resetForm();
    } catch (err) {
      console.error("Failed to save place:", err);
      setError(
        "Unable to save place. Please check your Firestore Rules and try again."
      );
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (place) => {
    setNewPlace({
      date: place.date || "",
      name: place.name || "",
      category: place.category || "Sightseeing",
      location: place.location || "",
      mapsUrl: place.mapsUrl || "",
    });

    setEditingId(place.id);
    setShowForm(true);
    setError("");
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Are you sure you want to delete this place?")) {
      return;
    }

    if (!auth.currentUser) {
      setError("You are not logged in.");
      return;
    }

    try {
      const placeRef = doc(
        db,
        mode === "group" ? "groups" : "users",
        mode === "group"
          ? selectedGroupId
          : auth.currentUser.uid,
        "places",
        id
      );

      await deleteDoc(placeRef);
      setError("");
    } catch (err) {
      console.error("Failed to delete place:", err);
      setError("Unable to delete place. Please try again.");
    }
  };

  const handleToggleVisited = async (place) => {
    if (!auth.currentUser) {
      setError("You are not logged in.");
      return;
    }

    try {
      const placeRef = doc(
        db,
        mode === "group" ? "groups" : "users",
        mode === "group"
          ? selectedGroupId
          : auth.currentUser.uid,
        "places",
        place.id
      );

      await updateDoc(placeRef, {
        visited: !place.visited,
        updatedAt: serverTimestamp(),
      });

      setError("");
    } catch (err) {
      console.error("Failed to update visited status:", err);
      setError("Unable to update place. Please try again.");
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return "Date not set";

    const date = new Date(`${dateString}T00:00:00`);

    if (Number.isNaN(date.getTime())) return "Date not set";

    return date.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
    });
  };

  const getCategoryIcon = (category) => {
    if (category === "Food") return "🍜";
    if (category === "Shopping") return "🛍️";
    if (category === "Cafe") return "☕";
    return "📍";
  };

  const sortedPlaces = [...places].sort((a, b) =>
    (a.date || "").localeCompare(b.date || "")
  );

  if (mode === "group" && groupsLoading) {
    return (
      <div className="places-page">
        <div className="empty-state">
          <span>👥</span>
          <p>Loading your groups...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="places-page">
      <header className="places-header">
        <div>
          <p>
            ✈️{" "}
            {mode === "group"
              ? selectedGroup?.tripSettings?.name ||
                selectedGroup?.name ||
                "Group Trip"
              : trip?.name}
          </p>
          <h1>Places</h1>
        </div>

        <button
          className="add-button"
          disabled={mode === "group" && !selectedGroupId}
          onClick={() => {
            if (showForm) {
              resetForm();
            } else {
              setNewPlace({
                ...EMPTY_PLACE,
                date: defaultDate,
              });
              setEditingId(null);
              setShowForm(true);
              setError("");
            }
          }}
        >
          {showForm ? "Cancel" : "+ Add"}
        </button>
      </header>

      <div className="places-mode-switch">
        <button
          className={mode === "personal" ? "active" : ""}
          onClick={() => handleModeChange("personal")}
        >
          👤 Personal Places
        </button>

        <button
          className={mode === "group" ? "active" : ""}
          onClick={() => handleModeChange("group")}
        >
          👥 Group Places
        </button>
      </div>

      {mode === "group" && (
        <div className="places-group-selector">
          <label htmlFor="places-group">Select Group</label>

          {groups.length > 0 ? (
            <select
              id="places-group"
              value={selectedGroupId}
              onChange={handleGroupChange}
            >
              {groups.map((group) => (
                <option key={group.id} value={group.id}>
                 {group.tripSettings?.name || group.name}
                </option>
              ))}
            </select>
          ) : (
            <p>
              You have not joined any groups yet. Create or join a group
              first.
            </p>
          )}
        </div>
      )}

      {error && (
        <p className="places-error" role="alert">
          {error}
        </p>
      )}

      {showForm && (
        <form className="place-form" onSubmit={handleAdd}>
          <h2>{editingId !== null ? "Edit Place" : "Add Place"}</h2>
          <div className="place-form-grid">
          <label>
            Date
            <input
              type="date"
              name="date"
              value={newPlace.date}
              onChange={handleChange}
            />
          </label>

          <label className="place-field-wide">
            Place Name
            <input
              type="text"
              name="name"
              placeholder="e.g. Tokyo Tower"
              value={newPlace.name}
              onChange={handleChange}
              required
            />
          </label>

          <label>
            Category
            <select
              name="category"
              value={newPlace.category}
              onChange={handleChange}
            >
              {CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </label>

          <label className="place-field-wide">
            Location
            <input
              type="text"
              name="location"
              placeholder="e.g. Minato, Tokyo"
              value={newPlace.location}
              onChange={handleChange}
              required
            />
          </label>

          <label className="place-field-wide">
            Google Maps Link
            <input
              type="url"
              name="mapsUrl"
              placeholder="Paste Google Maps link"
              value={newPlace.mapsUrl}
              onChange={handleChange}
            />
          </label>
          </div>
          <div className="form-buttons">
            <button type="button" onClick={resetForm} disabled={saving}>
              Cancel
            </button>

            <button type="submit" disabled={saving}>
              {saving
                ? "Saving..."
                : editingId !== null
                  ? "Update Place"
                  : "Add Place"}
            </button>
          </div>
        </form>
      )}

      <main className="places-list">
        {loading ? (
          <div className="empty-state">
            <span>📍</span>
            <p>Loading places...</p>
          </div>
        ) : (
          <>
            <div className="places-summary">
              <div>
                <strong>{places.length}</strong>
                <span>Total Places</span>
              </div>

              <div>
                <strong>
                  {places.filter((place) => place.visited).length}
                </strong>
                <span>Visited</span>
              </div>

              <div>
                <strong>
                  {places.filter((place) => !place.visited).length}
                </strong>
                <span>Remaining</span>
              </div>
            </div>

            <h2>
              {mode === "group" ? "Shared Places" : "My Places"}
            </h2>

            {sortedPlaces.length === 0 ? (
              <div className="empty-state">
                <span>📍</span>
                <p>
                  {mode === "group"
                    ? "No shared places added yet."
                    : "No places added yet."}
                </p>
                <small>
                  Add your first place to start planning.
                </small>
              </div>
            ) : (
              sortedPlaces.map((place) => (
                <div
                  className={`place-card ${place.visited ? "visited" : ""}`}
                  key={place.id}
                >
                  <div className="place-icon">
                    {getCategoryIcon(place.category)}
                  </div>

                  <div className="place-info">
                    <div className="place-title-row">
                      <h3>{place.name}</h3>

                      {place.visited && (
                        <span className="visited-badge">
                          ✓ Visited
                        </span>
                      )}
                    </div>

                    <p className="place-category">{place.category}</p>
                    <p className="place-location">📍 {place.location}</p>
                    <p className="place-date">
                      📅 {formatDate(place.date)}
                    </p>

                    <div className="place-actions">
                      <button onClick={() => handleEdit(place)}>
                        ✏️ Edit
                      </button>

                      <button onClick={() => handleToggleVisited(place)}>
                        {place.visited
                          ? "↩ Mark Unvisited"
                          : "✓ Mark Visited"}
                      </button>

                      {place.mapsUrl && (
                        <a
                          href={place.mapsUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          🗺️ Maps
                        </a>
                      )}

                      <button
                        className="delete-place"
                        onClick={() => handleDelete(place.id)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </>
        )}
      </main>
    </div>
  );
}

export default Places;