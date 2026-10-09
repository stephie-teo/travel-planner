
import { useEffect, useMemo, useState } from "react";
import "./Itinerary.css";

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

function Itinerary({
  trip,
  dashboardMode,
  onDashboardModeChange,
  selectedGroupId: sharedSelectedGroupId,
  onSelectedGroupChange,
}) {
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [localMode, setLocalMode] = useState("personal");
  const [groups, setGroups] = useState([]);
  const [localSelectedGroupId, setLocalSelectedGroupId] =
    useState("");
  const [groupLoading, setGroupLoading] = useState(true);

  const [selectedDate, setSelectedDate] = useState(
    trip?.startDate || ""
  );

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState("");

  const [newActivity, setNewActivity] = useState({
    time: "",
    title: "",
    location: "",
    notes: "",
  });

  const user = auth.currentUser;

  // Use the Dashboard mode when the parent provides it.
  const mode =
    dashboardMode === "personal" || dashboardMode === "group"
      ? dashboardMode
      : localMode;

  // Keep the mode shared with the Dashboard.
  const setMode = (nextMode) => {
    if (typeof onDashboardModeChange === "function") {
      onDashboardModeChange(nextMode);
    } else {
      setLocalMode(nextMode);
    }
  };

  // Use the selected group from App.jsx when provided.
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

  // Find the currently selected group.
  const selectedGroup = groups.find(
    (group) => group.id === selectedGroupId
  );

  // Personal mode uses personal trip settings.
  // Group mode uses the selected group's shared trip settings.
  const activeTrip = useMemo(() => {
    if (mode === "group") {
      const sharedSettings = selectedGroup?.tripSettings;

      return {
        name:
          sharedSettings?.name ||
          selectedGroup?.name ||
          "Group Trip",
        destination: sharedSettings?.destination || "",
        startDate: sharedSettings?.startDate || "",
        endDate: sharedSettings?.endDate || "",
        budget: Number(sharedSettings?.budget ?? 0),
      };
    }

    return {
      name: trip?.name || "My Trip",
      destination: trip?.destination || "",
      startDate: trip?.startDate || "",
      endDate: trip?.endDate || "",
      budget: Number(trip?.budget ?? 0),
    };
  }, [mode, selectedGroup, trip]);

  // Build all dates between the trip start and end dates.
  const tripDates = useMemo(() => {
    const dates = [];

    if (!activeTrip.startDate || !activeTrip.endDate) {
      return dates;
    }

    if (activeTrip.endDate < activeTrip.startDate) {
      return dates;
    }

    const start = new Date(
      `${activeTrip.startDate}T00:00:00`
    );
    const end = new Date(
      `${activeTrip.endDate}T00:00:00`
    );

    if (
      Number.isNaN(start.getTime()) ||
      Number.isNaN(end.getTime())
    ) {
      return dates;
    }

    const current = new Date(start);

    while (current <= end) {
      const year = current.getFullYear();
      const month = String(current.getMonth() + 1).padStart(
        2,
        "0"
      );
      const day = String(current.getDate()).padStart(2, "0");

      dates.push(`${year}-${month}-${day}`);
      current.setDate(current.getDate() + 1);
    }

    return dates;
  }, [activeTrip.startDate, activeTrip.endDate]);

  // Keep the selected date within the current trip.
  useEffect(() => {
    if (tripDates.length === 0) {
      setSelectedDate("");
      return;
    }

    setSelectedDate((previousDate) => {
      if (tripDates.includes(previousDate)) {
        return previousDate;
      }

      return tripDates[0];
    });
  }, [tripDates]);

  // Load groups that the current user belongs to.
  useEffect(() => {
    if (!auth.currentUser) {
      setGroups([]);
      setGroupLoading(false);
      return;
    }

    setGroupLoading(true);

    const groupsQuery = query(
      collection(db, "groups"),
      where(
        "memberIds",
        "array-contains",
        auth.currentUser.uid
      )
    );

    const unsubscribe = onSnapshot(
      groupsQuery,
      (snapshot) => {
        const loadedGroups = snapshot.docs.map((item) => ({
          id: item.id,
          ...item.data(),
        }));

        setGroups(loadedGroups);
        setGroupLoading(false);
      },
      (err) => {
        console.error("Failed to load groups:", err);
        setError(
          "Unable to load groups. Please check Firestore Rules."
        );
        setGroupLoading(false);
      }
    );

    return () => unsubscribe();
  }, []);


  // Keep the Dashboard's selected group.
  // Only select the first group when there is no selection at all.
  useEffect(() => {
    if (groups.length === 0) {
      return;
    }

    const currentId =
      typeof sharedSelectedGroupId === "string"
        ? sharedSelectedGroupId
        : localSelectedGroupId;

    // Keep the currently selected group if it still exists.
    if (currentId && groups.some((group) => group.id === currentId)) {
      return;
    }

    // If there is no valid selection, choose the first available group.
    const firstGroupId = groups[0].id;

    if (typeof onSelectedGroupChange === "function") {
      onSelectedGroupChange(firstGroupId);
    } else {
      setLocalSelectedGroupId(firstGroupId);
    }
  }, [
    groups,
    sharedSelectedGroupId,
    localSelectedGroupId,
    onSelectedGroupChange,
  ]);

  // Subscribe to the selected personal or group itinerary.
  useEffect(() => {
    if (!auth.currentUser) {
      setActivities([]);
      setLoading(false);
      return;
    }

    if (mode === "group" && !selectedGroupId) {
      setActivities([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");

    const activitiesRef =
      mode === "group"
        ? collection(
            db,
            "groups",
            selectedGroupId,
            "activities"
          )
        : collection(
            db,
            "users",
            auth.currentUser.uid,
            "activities"
          );

    const unsubscribe = onSnapshot(
      activitiesRef,
      (snapshot) => {
        const activityData = snapshot.docs.map((item) => ({
          id: item.id,
          ...item.data(),
        }));

        setActivities(activityData);
        setLoading(false);
      },
      (err) => {
        console.error("Failed to load activities:", err);

        setError(
          `Unable to load itinerary (${
            err.code || "unknown error"
          }).`
        );

        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [mode, selectedGroupId]);

  // Filter activities for the selected day.
  const filteredActivities = activities
    .filter((activity) => activity.date === selectedDate)
    .sort((a, b) =>
      (a.time || "").localeCompare(b.time || "")
    );

  const selectedDayIndex = tripDates.indexOf(selectedDate);
  const selectedDay =
    selectedDayIndex >= 0 ? selectedDayIndex + 1 : 0;

  const formatDate = (dateString) => {
    if (!dateString) return "Not set";

    const date = new Date(`${dateString}T00:00:00`);

    if (Number.isNaN(date.getTime())) {
      return "Not set";
    }

    return date.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  };

  const resetForm = () => {
    setNewActivity({
      time: "",
      title: "",
      location: "",
      notes: "",
    });

    setEditingId(null);
    setShowForm(false);
  };

  const handleChange = (event) => {
    const { name, value } = event.target;

    setNewActivity((previous) => ({
      ...previous,
      [name]: value,
    }));
  };

  // Add or update an activity.
  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!newActivity.title.trim() || !newActivity.time) {
      alert("Please enter the activity and time.");
      return;
    }

    if (!auth.currentUser) {
      alert("You are not logged in.");
      return;
    }

    if (mode === "group" && !selectedGroupId) {
      alert("Please select a group first.");
      return;
    }

    if (
      !selectedDate ||
      !tripDates.includes(selectedDate)
    ) {
      alert("Please select a valid date within the trip.");
      return;
    }

    setSaving(true);
    setError("");

    try {
      const activitiesRef =
        mode === "group"
          ? collection(
              db,
              "groups",
              selectedGroupId,
              "activities"
            )
          : collection(
              db,
              "users",
              auth.currentUser.uid,
              "activities"
            );

      const activityData = {
        date: selectedDate,
        time: newActivity.time,
        title: newActivity.title.trim(),
        location: newActivity.location.trim(),
        notes: newActivity.notes.trim(),
      };

      if (editingId !== null) {
        const activityRef = doc(
          activitiesRef,
          editingId
        );

        await updateDoc(activityRef, {
          ...activityData,
          ...(mode === "group"
            ? { updatedAt: serverTimestamp() }
            : {}),
        });
      } else {
        await addDoc(activitiesRef, {
          ...activityData,
          ...(mode === "group"
            ? {
                createdBy: auth.currentUser.uid,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
              }
            : {}),
        });
      }

      resetForm();
    } catch (err) {
      console.error("Failed to save activity:", err);

      setError(
        `Unable to save activity (${
          err.code || "unknown error"
        }).`
      );
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (activity) => {
    setNewActivity({
      time: activity.time || "",
      title: activity.title || "",
      location: activity.location || "",
      notes: activity.notes || "",
    });

    setEditingId(activity.id);
    setShowForm(true);
    setError("");
  };

  // Delete an activity.
  const handleDelete = async (id) => {
    const confirmed = window.confirm(
      "Are you sure you want to delete this activity?"
    );

    if (!confirmed || !auth.currentUser) return;

    if (mode === "group" && !selectedGroupId) return;

    try {
      const activityRef =
        mode === "group"
          ? doc(
              db,
              "groups",
              selectedGroupId,
              "activities",
              id
            )
          : doc(
              db,
              "users",
              auth.currentUser.uid,
              "activities",
              id
            );

      await deleteDoc(activityRef);
      setError("");
    } catch (err) {
      console.error("Failed to delete activity:", err);

      setError(
        `Unable to delete activity (${
          err.code || "unknown error"
        }).`
      );
    }
  };

  return (
    <div className="itinerary-page">
      {/* HEADER */}
      <header className="itinerary-header">
        <div>
          <p>✈️ {activeTrip.name}</p>
          <h1>Itinerary</h1>
        </div>

        <button
          className="add-button"
          type="button"
          onClick={() => {
            resetForm();
            setShowForm(true);
          }}
          disabled={
            saving ||
            (mode === "group" && !selectedGroupId) ||
            tripDates.length === 0
          }
          title={
            tripDates.length === 0
              ? "Set the trip dates before adding activities."
              : ""
          }
        >
          + Add
        </button>
      </header>

      {/* PERSONAL / GROUP MODE */}
      <section className="itinerary-mode">
        <label htmlFor="itineraryMode">
          Itinerary type
        </label>

        <select
          id="itineraryMode"
          value={mode}
          onChange={(event) => {
            resetForm();
            setError("");
            setMode(event.target.value);
          }}
        >
          <option value="personal">
            Personal Itinerary
          </option>
          <option value="group">
            Group Itinerary
          </option>
        </select>

        {mode === "group" && (
          <>
            <label htmlFor="itineraryGroup">
              Select group
            </label>

            {groupLoading ? (
              <p>Loading groups...</p>
            ) : groups.length === 0 ? (
              <p>
                You have not joined any groups yet. Create or
                join a group from the Groups page first.
              </p>
            ) : (
              <select
                id="itineraryGroup"
                value={selectedGroupId}
                onChange={(event) => {
                  resetForm();
                  setSelectedGroupId(event.target.value);
                  setError("");
                }}
              >
                {groups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.tripSettings?.name || group.name}
                  </option>
                ))}
              </select>
            )}

            {selectedGroupId && selectedGroup && (
              <p>
                Shared with members of {selectedGroup.tripSettings?.name || selectedGroup.name}
              </p>
            )}
          </>
        )}
      </section>

      {/* SHARED GROUP DETAILS */}
      {mode === "group" && selectedGroup && (
        <section className="group-form">
          <h2>🌍 Shared Trip Details</h2>

          <p>
            <strong>Destination:</strong>{" "}
            {activeTrip.destination || "Not set"}
          </p>

          <p>
            <strong>Dates:</strong>{" "}
            {formatDate(activeTrip.startDate)} –{" "}
            {formatDate(activeTrip.endDate)}
          </p>

          <p>
            <strong>Group Budget:</strong> RM{" "}
            {activeTrip.budget.toLocaleString("en-MY", {
              maximumFractionDigits: 2,
            })}
          </p>

          {!activeTrip.startDate ||
          !activeTrip.endDate ? (
            <p>
              The group owner needs to set the shared trip
              dates on the Groups page before activities can
              be added.
            </p>
          ) : null}
        </section>
      )}

      {error && (
        <p className="groups-error">{error}</p>
      )}

      {/* DATE SELECTOR */}
      {tripDates.length > 0 ? (
        <div className="date-selector">
          {tripDates.map((date) => {
            const dateObject = new Date(
              `${date}T00:00:00`
            );

            const day = dateObject.getDate();

            const month = dateObject
              .toLocaleDateString("en-GB", {
                month: "short",
              })
              .toUpperCase();

            const weekday = dateObject
            .toLocaleDateString("en-GB", {
              weekday: "short",
            })
            .toUpperCase();

            return (
              <button
                type="button"
                key={date}
                className={
                  selectedDate === date ? "selected" : ""
                }
                onClick={() => {
                  setSelectedDate(date);
                  resetForm();
                }}
              >
               <small className="date-weekday">{weekday}</small>
              <span>{day}</span>
              <small className="date-month">{month}</small>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="empty-state">
          <span>📅</span>
          <p>
            {mode === "group"
              ? "No shared trip dates have been set yet."
              : "Set your personal trip dates in Trip Settings first."}
          </p>
        </div>
      )}

      {/* ADD / EDIT FORM */}
      {showForm && tripDates.length > 0 && (
        <form
          className="activity-form"
          onSubmit={handleSubmit}
        >
          <h2>
            {editingId !== null
              ? "Edit Activity"
              : "Add Activity"}
          </h2>

          <p>Date: {formatDate(selectedDate)}</p>
        <div className="activity-form-row">
          <label>
            Time
            <input
              type="time"
              name="time"
              value={newActivity.time}
              onChange={handleChange}
              required
            />
          </label>
        </div>
          <label>
            Activity
            <input
              type="text"
              name="title"
              placeholder="e.g. Visit a place"
              value={newActivity.title}
              onChange={handleChange}
              required
            />
          </label>

          <label>
            Location
            <input
              type="text"
              name="location"
              placeholder="e.g. City Center"
              value={newActivity.location}
              onChange={handleChange}
            />
          </label>

          <label>
            Notes
            <textarea
              name="notes"
              placeholder="Additional notes..."
              value={newActivity.notes}
              onChange={handleChange}
            />
          </label>

          <div className="form-buttons">
            <button
              type="button"
              onClick={resetForm}
            >
              Cancel
            </button>

            <button
              type="submit"
              disabled={saving}
            >
              {saving
                ? "Saving..."
                : editingId !== null
                ? "Update Activity"
                : "Save Activity"}
            </button>
          </div>
        </form>
      )}

      {/* ACTIVITIES */}
      <main className="activities">
        {tripDates.length > 0 && (
          <h2>Day {selectedDay}</h2>
        )}

        {loading ? (
          <div className="empty-state">
            <span>🗓️</span>
            <p>Loading itinerary...</p>
          </div>
        ) : mode === "group" && !selectedGroupId ? (
          <div className="empty-state">
            <span>👥</span>
            <p>Select a group to view its itinerary.</p>
          </div>
        ) : mode === "group" && groups.length === 0 ? (
          <div className="empty-state">
            <span>👥</span>
            <p>
              Join a group to start planning together.
            </p>
          </div>
        ) : tripDates.length === 0 ? (
          <div className="empty-state">
            <span>📅</span>
            <p>
              Set the trip dates to view the daily itinerary.
            </p>
          </div>
        ) : filteredActivities.length === 0 ? (
          <div className="empty-state">
            <span>🗓️</span>
            <p>No activities planned for this day.</p>
            <small>Click "+ Add" to create one.</small>
          </div>
        ) : (
          filteredActivities.map((activity) => (
            <div
              className="activity-card"
              key={activity.id}
            >
              <div className="activity-time">
                {activity.time}
              </div>

              <div className="activity-line"></div>

              <div className="activity-content">
                <h3>{activity.title}</h3>

                {activity.location && (
                  <p>📍 {activity.location}</p>
                )}

                {activity.notes && (
                  <p>📝 {activity.notes}</p>
                )}

                {mode === "group" &&
                  activity.createdBy && (
                    <small>
                      Added by{" "}
                      {activity.createdBy === user?.uid
                        ? "you"
                        : "a group member"}
                    </small>
                  )}

                <div className="activity-actions">
                  <button
                    type="button"
                    className="edit-button"
                    onClick={() => handleEdit(activity)}
                  >
                    Edit
                  </button>

                  <button
                    type="button"
                    className="delete-button"
                    onClick={() =>
                      handleDelete(activity.id)
                    }
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </main>
    </div>
  );
}

export default Itinerary;