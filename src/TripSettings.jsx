import { useEffect, useState } from "react";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db, auth } from "./firebase";
import "./TripSettings.css";

function TripSettings({ onSave, onBack }) {
  const defaultTrip = {
    name: "",
    destination: "",
    startDate: "",
    endDate: "",
    budget: "",
  };

  const [trip, setTrip] = useState(defaultTrip);

  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
  const loadTrip = async () => {
    if (!auth.currentUser) {
      return;
    }

    try {
      const tripRef = doc(
        db,
        "users",
        auth.currentUser.uid,
        "settings",
        "trip"
      );

      const tripSnap = await getDoc(tripRef);

      if (tripSnap.exists()) {
        setTrip(tripSnap.data());
      }
    } catch (error) {
      console.error(
        "Failed to load trip:",
        error
      );
    }
  };

  loadTrip();
}, []);

  const handleChange = (e) => {
    const { name, value } = e.target;

    setTrip((prev) => ({
      ...prev,
      [name]: value,
    }));

    setSaved(false);
    setError("");
  };

  const handleSave = async () => {
  if (!trip.name.trim()) {
    setError("Please enter a trip name.");
    return;
  }

  if (!trip.destination.trim()) {
    setError("Please enter a destination.");
    return;
  }

  if (!trip.startDate || !trip.endDate) {
    setError("Please select both start and end dates.");
    return;
  }

  if (trip.endDate < trip.startDate) {
    setError("End date cannot be earlier than start date.");
    return;
  }

  const budget = Number(trip.budget);

if (
  trip.budget === "" ||
  !Number.isFinite(budget) ||
  budget < 0
) {
  setError("Please enter a valid budget of RM 0 or above.");
  return;
}

  if (!auth.currentUser) {
    setError("You are not logged in.");
    return;
  }

  try {
    const tripRef = doc(
      db,
      "users",
      auth.currentUser.uid,
      "settings",
      "trip"
    );

    await setDoc(tripRef, {
      ...trip,
      budget: Number(trip.budget),
    });

    setSaved(true);
    setError("");

    if (onSave) {
      onSave();
    }
  } catch (error) {
    console.error(
      "Failed to save trip:",
      error
    );

    setError(
      "Unable to save trip. Please try again."
    );
  }
};

  const formatDate = (dateString) => {
    if (!dateString) return "";

    const date = new Date(
      `${dateString}T00:00:00`
    );

    return date.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  };

  return (
    <div className="trip-settings-page">

      {/* Header */}
      <div className="trip-settings-header">

        <div className="settings-header-left">
          <button
            className="back-button"
            onClick={onBack}
          >
            ←
          </button>

          <div>
            <p>MY TRIP</p>
            <h1>Trip Settings</h1>
          </div>
        </div>

        <span className="settings-icon">
          ⚙️
        </span>

      </div>

      <div className="trip-settings-content">

        {/* Trip Details */}
        <div className="settings-card">

          <div className="settings-card-title">
            <span>🗺️</span>
            <h2>Trip Details</h2>
          </div>

          <div className="settings-form">

            <label>
              Trip Name

              <input
                type="text"
                name="name"
                value={trip.name}
                onChange={handleChange}
                placeholder="e.g. Tokyo Trip"
              />
            </label>

            <label>
              Destination

              <input
                type="text"
                name="destination"
                value={trip.destination}
                onChange={handleChange}
                placeholder="e.g. Tokyo, Japan"
              />
            </label>

            <div className="date-row">

              <label>
                Start Date

                <input
                  type="date"
                  name="startDate"
                  value={trip.startDate}
                  onChange={handleChange}
                />
              </label>

              <label>
                End Date

                <input
                  type="date"
                  name="endDate"
                  value={trip.endDate}
                  min={trip.startDate}
                  onChange={handleChange}
                />
              </label>

            </div>

            <label>
              Budget (RM)

              <input
                type="number"
                name="budget"
                value={trip.budget}
                onChange={handleChange}
                min="0"
                placeholder="2500"
              />
            </label>

          </div>
        </div>

        {/* Preview */}
        <div className="settings-card">

          <div className="settings-card-title">
            <span>👀</span>
            <h2>Preview</h2>
          </div>

          <div className="trip-preview">

            <p className="preview-label">
              CURRENT TRIP
            </p>

            <h3>
              ✈️ {trip.name || "My Trip"}
            </h3>

            <p className="preview-destination">
              📍 {trip.destination || "Destination"}
            </p>

            <p className="preview-date">
              📅 {formatDate(trip.startDate)} –{" "}
              {formatDate(trip.endDate)}
            </p>

            <p className="preview-budget">
              💰 RM{" "}
              {Number(
                trip.budget || 0
              ).toLocaleString()}
            </p>

          </div>

        </div>

        {/* Error Message */}
        {error && (
          <div className="settings-error">
            ⚠️ {error}
          </div>
        )}

        {/* Save Button */}
        <button
          className="save-trip-button"
          onClick={handleSave}
        >
          {saved ? "✓ Saved!" : "Save Trip"}
        </button>

      </div>
    </div>
  );
}

export default TripSettings;