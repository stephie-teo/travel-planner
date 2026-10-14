import { useEffect, useState } from "react";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db, auth } from "./firebase";
import "./TripSettings.css";

const DEFAULT_TRIP = { name: "", destination: "", startDate: "", endDate: "", budget: "" };

function TripSettings({ selectedTripId = null, onSave, onBack }) {
  const [trip, setTrip] = useState({ ...DEFAULT_TRIP });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const uid = auth.currentUser?.uid;

  const getTripRef = () => {
    if (!uid) return null;
    return selectedTripId ? doc(db, "users", uid, "trips", selectedTripId) : null;
  };

  useEffect(() => {
    let cancelled = false;
    setTrip({ ...DEFAULT_TRIP });
    setLoading(true);
    setSaved(false);
    setError("");
    const loadTrip = async () => {
      if (!uid || !selectedTripId) {
        if (!cancelled) {
          setError(!uid ? "You are not logged in." : "Select or create a trip in My Trips first.");
          setLoading(false);
        }
        return;
      }
      try {
        const ref = doc(db, "users", uid, "trips", selectedTripId);
        const snap = await getDoc(ref);
        if (!cancelled) {
          setTrip(snap.exists() ? { ...DEFAULT_TRIP, ...snap.data() } : { ...DEFAULT_TRIP });
          if (!snap.exists() && selectedTripId) setError("This trip could not be found. Changes are disabled.");
        }
      } catch (err) {
        console.error("Failed to load trip:", err);
        if (!cancelled) setError("Unable to load trip settings.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    loadTrip();
    return () => { cancelled = true; };
  }, [uid, selectedTripId]);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setTrip(prev => ({ ...prev, [name]: value }));
    setSaved(false);
    setError("");
  };

  const handleSave = async () => {
    if (saving || loading) return;
    if (!selectedTripId) { setError("Select or create a trip in My Trips first."); return; }
    if (!trip.name?.trim()) { setError("Please enter a trip name."); return; }
    if (!trip.destination?.trim()) { setError("Please enter a destination."); return; }
    if (!trip.startDate || !trip.endDate) { setError("Please select both start and end dates."); return; }
    if (trip.endDate < trip.startDate) { setError("End date cannot be earlier than start date."); return; }
    const budget = Number(trip.budget);
    if (trip.budget === "" || !Number.isFinite(budget) || budget < 0) {
      setError("Please enter a valid budget of RM 0 or above."); return;
    }
    const tripRef = getTripRef();
    if (!tripRef) { setError("You are not logged in."); return; }
    setSaving(true);
    try {
      // Merge preserves V2 trip metadata (ownerId, createdAt, etc.).
      // An existing V2 trip must not be accidentally recreated.
      if (selectedTripId) {
        const existing = await getDoc(tripRef);
        if (!existing.exists() || existing.data()?.archived === true) {
          setError("This trip is unavailable or archived. Nothing was saved.");
          return;
        }
      }
      await setDoc(tripRef, {
        name: trip.name.trim(),
        destination: trip.destination.trim(),
        startDate: trip.startDate,
        endDate: trip.endDate,
        budget,
      }, { merge: true });
      setSaved(true);
      setError("");
      if (onSave) await onSave();
    } catch (err) {
      console.error("Failed to save trip:", err);
      setError("Unable to save trip. Please try again.");
    } finally { setSaving(false); }
  };

  const formatDate = (dateString) => {
    if (!dateString) return "";
    const date = new Date(`${dateString}T00:00:00`);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  };

  return (
    <div className="trip-settings-page">
      <div className="trip-settings-header">
        <div className="settings-header-left">
          <button className="back-button" onClick={onBack} type="button">←</button>
          <div><p>MY TRIP</p><h1>Trip Settings</h1></div>
        </div>
        <span className="settings-icon">⚙️</span>
      </div>
      <div className="trip-settings-content">
        <div className="settings-card">
          <div className="settings-card-title"><span>🗺️</span><h2>Trip Details</h2></div>
          {loading ? <p>Loading trip settings...</p> : (
            <div className="settings-form">
              <label>Trip Name<input type="text" name="name" value={trip.name ?? ""} onChange={handleChange} placeholder="e.g. Tokyo Trip" /></label>
              <label>Destination<input type="text" name="destination" value={trip.destination ?? ""} onChange={handleChange} placeholder="e.g. Tokyo, Japan" /></label>
              <div className="date-row">
                <label>Start Date<input type="date" name="startDate" value={trip.startDate ?? ""} onChange={handleChange} /></label>
                <label>End Date<input type="date" name="endDate" value={trip.endDate ?? ""} min={trip.startDate || undefined} onChange={handleChange} /></label>
              </div>
              <label>Budget (RM)<input type="number" name="budget" value={trip.budget ?? ""} onChange={handleChange} min="0" placeholder="2500" /></label>
            </div>
          )}
        </div>
        <div className="settings-card">
          <div className="settings-card-title"><span>👀</span><h2>Preview</h2></div>
          <div className="trip-preview">
            <p className="preview-label">CURRENT TRIP</p>
            <h3>✈️ {trip.name || "My Trip"}</h3>
            <p className="preview-destination">📍 {trip.destination || "Destination"}</p>
            <p className="preview-date">📅 {formatDate(trip.startDate)} – {formatDate(trip.endDate)}</p>
            <p className="preview-budget">💰 RM {Number(trip.budget || 0).toLocaleString()}</p>
          </div>
        </div>
        {error && <div className="settings-error">⚠️ {error}</div>}
        <button className="save-trip-button" type="button" disabled={loading || saving || !selectedTripId || !!error && (error.includes("not found") || error.includes("archived") || error.includes("unavailable"))} onClick={handleSave}>
          {saving ? "Saving..." : saved ? "✓ Saved!" : "Save Trip"}
        </button>
      </div>
    </div>
  );
}

export default TripSettings;
