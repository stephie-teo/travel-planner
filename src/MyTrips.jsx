import { useEffect, useState } from "react";
import { addDoc, collection, getDocs, serverTimestamp } from "firebase/firestore";
import { auth, db } from "./firebase";
import "./MyTrips.css";

const EMPTY_FORM = { name: "", destination: "", startDate: "", endDate: "", budget: "" };

export default function MyTrips({ onBack }) {
  const [trips, setTrips] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const loadTrips = async () => {
    const uid = auth.currentUser?.uid;
    if (!uid) { setError("Please log in again."); setLoading(false); return; }
    setLoading(true);
    try {
      const snapshot = await getDocs(collection(db, "users", uid, "trips"));
      const items = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
      items.sort((a, b) => (a.startDate || "").localeCompare(b.startDate || ""));
      setTrips(items);
      setError("");
    } catch (err) {
      console.error("Could not load trips", err);
      setError("Could not load trips. Please check your connection and permissions.");
    } finally { setLoading(false); }
  };

  useEffect(() => { loadTrips(); }, []);

  const handleCreate = async (event) => {
    event.preventDefault();
    const uid = auth.currentUser?.uid;
    if (!uid) { setError("Please log in again."); return; }
    if (!form.name.trim() || !form.destination.trim() || !form.startDate || !form.endDate) {
      setError("Please complete the trip name, destination and dates."); return;
    }
    if (form.endDate < form.startDate) { setError("End date cannot be before start date."); return; }
    if (form.budget === "" || !Number.isFinite(Number(form.budget)) || Number(form.budget) < 0) {
      setError("Please enter a valid budget (RM 0 or above)."); return;
    }
    setSaving(true);
    setError("");
    try {
      await addDoc(collection(db, "users", uid, "trips"), {
        name: form.name.trim(), destination: form.destination.trim(),
        startDate: form.startDate, endDate: form.endDate,
        budget: Number(form.budget), createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      });
      setForm(EMPTY_FORM);
      setShowForm(false);
      await loadTrips();
    } catch (err) {
      console.error("Could not create trip", err);
      setError("Could not create the trip. Please try again.");
    } finally { setSaving(false); }
  };

  return (
    <main className="my-trips-page">
      <header className="my-trips-header">
        <div>
          <button className="my-trips-back" type="button" onClick={onBack}>← Back to Dashboard</button>
          <p className="my-trips-eyebrow">YOUR ADVENTURES</p>
          <h1>My Trips ✈️</h1>
          <p>Keep your travel plans together, one trip at a time.</p>
        </div>
        <button className="my-trips-primary" type="button" onClick={() => { setShowForm((v) => !v); setError(""); }}>
          {showForm ? "Cancel" : "+ New Trip"}
        </button>
      </header>

      {showForm && (
        <form className="my-trips-form" onSubmit={handleCreate}>
          <h2>Create a new trip</h2>
          <div className="my-trips-fields">
            <label>Trip name<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Seoul Trip" required /></label>
            <label>Destination<input value={form.destination} onChange={(e) => setForm({ ...form, destination: e.target.value })} placeholder="e.g. Seoul, South Korea" required /></label>
            <label>Start date<input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} required /></label>
            <label>End date<input type="date" min={form.startDate} value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} required /></label>
            <label>Budget (RM)<input type="number" min="0" step="0.01" value={form.budget} onChange={(e) => setForm({ ...form, budget: e.target.value })} placeholder="2500" required /></label>
          </div>
          <button className="my-trips-primary" type="submit" disabled={saving}>{saving ? "Creating..." : "Create Trip"}</button>
        </form>
      )}

      {error && <p className="my-trips-error" role="alert">⚠️ {error}</p>}
      {loading ? <p className="my-trips-empty">Loading your trips...</p> : trips.length === 0 ? (
        <div className="my-trips-empty"><span>🧭</span><h2>No V2 trips yet</h2><p>Your existing personal trip is still safely stored in the original location. Create a new trip to test this page.</p></div>
      ) : (
        <div className="my-trips-grid">
          {trips.map((item) => (
            <article className="my-trips-card" key={item.id}>
              <div className="my-trips-card-icon">🌍</div>
              <h2>{item.name || "Untitled Trip"}</h2>
              <p>📍 {item.destination || "No destination"}</p>
              <p>📅 {item.startDate || "?"} — {item.endDate || "?"}</p>
              <strong>RM {Number(item.budget || 0).toLocaleString("en-MY")}</strong>
              <small>Trip created · Opening and editing trips will be enabled in the next step.</small>
            </article>
          ))}
        </div>
      )}
    </main>
  );
}
