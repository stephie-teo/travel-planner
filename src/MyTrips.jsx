import { useEffect, useMemo, useState } from "react";
import { addDoc, collection, doc, getDocs, serverTimestamp, updateDoc, writeBatch } from "firebase/firestore";
import { auth, db } from "./firebase";
import "./MyTrips.css";

const EMPTY_FORM = { name: "", destination: "", startDate: "", endDate: "", budget: "" };
const money = (value) => `RM ${Number(value || 0).toLocaleString("en-MY", { maximumFractionDigits: 2 })}`;

function getTripStatus(item) {
  const today = new Date();
  const date = [today.getFullYear(), String(today.getMonth() + 1).padStart(2, "0"), String(today.getDate()).padStart(2, "0")].join("-");
  if (!item.startDate || !item.endDate || item.endDate < item.startDate) return "Unscheduled";
  if (date < item.startDate) return "Upcoming";
  if (date > item.endDate) return "Completed";
  return "Ongoing";
}

function getCover(destination = "") {
  const value = destination.toLowerCase();
  if (/tokyo|japan|osaka|kyoto|日本|东京|東京/.test(value)) return { emoji: "🗼", theme: "tokyo" };
  if (/seoul|korea|釜山|首尔|首爾|韩国|韓國/.test(value)) return { emoji: "🏯", theme: "seoul" };
  if (/paris|france|法国|法國/.test(value)) return { emoji: "🗼", theme: "paris" };
  if (/beach|bali|phuket|langkawi|maldives|海/.test(value)) return { emoji: "🏝️", theme: "beach" };
  if (/singapore|新加坡/.test(value)) return { emoji: "🌇", theme: "city" };
  if (/mountain|swiss|switzerland|山/.test(value)) return { emoji: "🏔️", theme: "mountain" };
  return { emoji: "✈️", theme: "default" };
}

function formatDate(date) {
  if (!date) return "Date not set";
  const parsed = new Date(`${date}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? date : parsed.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export default function MyTrips({ onBack, onSelectTrip, selectedTripId }) {
  const [trips, setTrips] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("All");
  const [sortBy, setSortBy] = useState("date-asc");
  const [showArchived, setShowArchived] = useState(false);
  const [updatingTripId, setUpdatingTripId] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let active = true;
    async function loadTrips() {
      const uid = auth.currentUser?.uid;
      if (!uid) {
        if (active) { setError("Please log in again."); setLoading(false); }
        return;
      }
      try {
        const snapshot = await getDocs(collection(db, "users", uid, "trips"));
        if (active) {
          setTrips(snapshot.docs.map((item) => ({ ...item.data(), id: item.id })));
          setError("");
        }
      } catch (err) {
        console.error("Could not load trips", err);
        if (active) setError("Could not load trips. Please check your connection and permissions.");
      } finally {
        if (active) setLoading(false);
      }
    }
    loadTrips();
    return () => { active = false; };
  }, []);

  const filteredTrips = useMemo(() => {
    const term = search.trim().toLowerCase();
    const result = trips.filter((item) => {
      if (Boolean(item.archived) !== showArchived) return false;
      const matchesSearch = !term || `${item.name || ""} ${item.destination || ""}`.toLowerCase().includes(term);
      const matchesStatus = filter === "All" || getTripStatus(item) === filter;
      return matchesSearch && matchesStatus;
    });
    result.sort((a, b) => {
      if (sortBy === "name") return (a.name || "").localeCompare(b.name || "");
      const comparison = (a.startDate || "9999-12-31").localeCompare(b.startDate || "9999-12-31");
      return sortBy === "date-desc" ? -comparison : comparison;
    });
    return result;
  }, [trips, search, filter, sortBy, showArchived]);

  const handleArchiveToggle = async (item) => {
    const isArchived = Boolean(item.archived);
    if (!isArchived && selectedTripId === item.id) {
      setError("Please switch to another trip before archiving your current trip.");
      return;
    }
    if (!window.confirm(isArchived
      ? `Restore "${item.name || "Untitled Trip"}" to your active trips?`
      : `Archive "${item.name || "Untitled Trip"}"? Its itinerary, expenses, places and other data will be kept.`)) return;
    const uid = auth.currentUser?.uid;
    if (!uid) { setError("Please log in again."); return; }
    setUpdatingTripId(item.id);
    setError("");
    try {
      await updateDoc(doc(db, "users", uid, "trips", item.id), {
        archived: !isArchived,
        updatedAt: serverTimestamp(),
      });
      setTrips((previous) => previous.map((trip) => trip.id === item.id
        ? { ...trip, archived: !isArchived }
        : trip));
    } catch (err) {
      console.error("Could not update trip archive status", err);
      setError("Could not update this trip. Please try again.");
    } finally {
      setUpdatingTripId(null);
    }
  };

  // Delete only the known V2 personal-trip collections. Firestore does not cascade
  // deletions, so the parent document is deliberately deleted last.
  const handleDelete = async (event) => {
    event.preventDefault();
    if (!deleteTarget || deleting) return;
    if (deleteConfirmation !== (deleteTarget.name || "Untitled Trip")) {
      setError("Type the exact trip name to confirm deletion.");
      return;
    }
    if (selectedTripId === deleteTarget.id) {
      setError("Switch to another trip before deleting the current trip.");
      setDeleteTarget(null);
      return;
    }
    const uid = auth.currentUser?.uid;
    if (!uid) { setError("Please log in again."); return; }
    setDeleting(true);
    setError("");
    try {
      const tripRef = doc(db, "users", uid, "trips", deleteTarget.id);
      const knownCollections = ["activities", "expenses", "places", "checklist", "settings"];
      // Collect references first: a failed read must never start deleting anything.
      const snapshots = await Promise.all(
        knownCollections.map((name) => getDocs(collection(tripRef, name)))
      );
      const childRefs = snapshots.flatMap((snapshot) => snapshot.docs.map((entry) => entry.ref));
      // Leave room below Firestore's 500-write batch limit.
      for (let index = 0; index < childRefs.length; index += 400) {
        const batch = writeBatch(db);
        childRefs.slice(index, index + 400).forEach((ref) => batch.delete(ref));
        await batch.commit();
      }
      // Delete the trip document only after all known child documents are removed.
      const batch = writeBatch(db);
      batch.delete(tripRef);
      await batch.commit();
      setTrips((previous) => previous.filter((trip) => trip.id !== deleteTarget.id));
      setDeleteTarget(null);
      setDeleteConfirmation("");
    } catch (err) {
      console.error("Could not delete trip completely", err);
      setError("Deletion could not finish. Some documents may already have been removed. Please check Firebase before trying again.");
    } finally {
      setDeleting(false);
    }
  };

  const handleCreate = async (event) => {
    event.preventDefault();
    if (saving) return;
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
      const newTripRef = await addDoc(collection(db, "users", uid, "trips"), {
        name: form.name.trim(), destination: form.destination.trim(),
        startDate: form.startDate, endDate: form.endDate,
        budget: Number(form.budget), createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      });
      setTrips((previous) => [...previous, { ...form, budget: Number(form.budget), id: newTripRef.id }]);
      setForm(EMPTY_FORM);
      setShowForm(false);
      // App.jsx handles switching, persistence and navigation.
      onSelectTrip?.(newTripRef.id);
    } catch (err) {
      console.error("Could not create trip", err);
      setError("Could not create the trip. Please try again.");
    } finally { setSaving(false); }
  };

  return (
    <main className="my-trips-page">
      <header className="my-trips-header">
        <div className="my-trips-heading">
          <button className="my-trips-back" type="button" onClick={onBack}>← Back to Dashboard</button>
          <p className="my-trips-eyebrow">YOUR ADVENTURES</p>
          <h1>My Trips <span aria-hidden="true">✈️</span></h1>
          <p>Every journey has a story. Keep all your travel plans in one place.</p>
        </div>
        <button className="my-trips-primary my-trips-new" type="button" aria-expanded={showForm}
          onClick={() => { setShowForm((value) => !value); setError(""); }}>
          {showForm ? "✕ Cancel" : "+ New Trip"}
        </button>
      </header>

      {showForm && (
        <form className="my-trips-form" onSubmit={handleCreate}>
          <div className="my-trips-form-heading"><span className="my-trips-form-emoji" aria-hidden="true">🧳</span><div><h2>Plan a new adventure</h2><p>Where will you go next?</p></div></div>
          <div className="my-trips-fields">
            <label>Trip name<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Seoul Trip" maxLength={100} required /></label>
            <label>Destination<input value={form.destination} onChange={(e) => setForm({ ...form, destination: e.target.value })} placeholder="e.g. Seoul, South Korea" maxLength={150} required /></label>
            <label>Start date<input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} required /></label>
            <label>End date<input type="date" min={form.startDate} value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} required /></label>
            <label>Budget (RM)<input type="number" min="0" step="0.01" value={form.budget} onChange={(e) => setForm({ ...form, budget: e.target.value })} placeholder="2500" required /></label>
          </div>
          <div className="my-trips-form-actions"><button className="my-trips-primary" type="submit" disabled={saving}>{saving ? "Creating..." : "Create Trip →"}</button></div>
        </form>
      )}

      {error && <p className="my-trips-error" role="alert">⚠️ {error}</p>}

      <div className="my-trips-overview">
        <div><strong>{trips.filter((item) => !item.archived).length}</strong><span>Active trips</span></div>
        <div><strong>{trips.filter((item) => !item.archived && getTripStatus(item) === "Upcoming").length}</strong><span>Upcoming</span></div>
        <div><strong>{trips.filter((item) => !item.archived && getTripStatus(item) === "Ongoing").length}</strong><span>Ongoing</span></div>
        <div><strong>{trips.filter((item) => !item.archived && getTripStatus(item) === "Completed").length}</strong><span>Completed</span></div>
      </div>

      <div className="my-trips-archive-tabs" role="group" aria-label="Trip archive view">
        <button type="button" className={!showArchived ? "active" : ""} aria-pressed={!showArchived}
          onClick={() => { setShowArchived(false); setSearch(""); setFilter("All"); }}>
          ✈️ Active Trips ({trips.filter((item) => !item.archived).length})
        </button>
        <button type="button" className={showArchived ? "active" : ""} aria-pressed={showArchived}
          onClick={() => { setShowArchived(true); setSearch(""); setFilter("All"); }}>
          📦 Archived ({trips.filter((item) => Boolean(item.archived)).length})
        </button>
      </div>

      <section className="my-trips-collection" aria-label="Your personal trips">
        <div className="my-trips-section-title"><div><p className="my-trips-eyebrow">EXPLORE YOUR JOURNEYS</p><h2>{showArchived ? "Archived trips" : "Your trip collection"}</h2></div><span>{filteredTrips.length} shown</span></div>
        <div className="my-trips-toolbar">
          <label className="my-trips-search"><span aria-hidden="true">⌕</span><input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search trips or destinations" aria-label="Search trips" /></label>
          <div className="my-trips-filters" role="group" aria-label="Filter by trip status">
            {["All", "Upcoming", "Ongoing", "Completed", "Unscheduled"].map((status) => (
              <button key={status} type="button" className={filter === status ? "active" : ""} aria-pressed={filter === status} onClick={() => setFilter(status)}>{status}</button>
            ))}
          </div>
          <select className="my-trips-sort" aria-label="Sort trips" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
            <option value="date-asc">Date: earliest first</option><option value="date-desc">Date: latest first</option><option value="name">Trip name: A–Z</option>
          </select>
        </div>

        {loading ? <div className="my-trips-empty"><span>⏳</span><h2>Loading your trips...</h2></div>
          : trips.length === 0 ? <div className="my-trips-empty"><span>🧭</span><h2>Your adventure starts here</h2><p>Create your first personal trip to begin planning.</p><button type="button" className="my-trips-primary" onClick={() => setShowForm(true)}>+ Create your first trip</button></div>
          : filteredTrips.length === 0 ? <div className="my-trips-empty"><span>🔎</span><h2>{showArchived ? "No archived trips found" : "No matching trips"}</h2><p>{showArchived ? "Archived trips will appear here. You can restore them at any time." : "Try a different search or filter."}</p><button type="button" className="my-trips-secondary" onClick={() => { setSearch(""); setFilter("All"); }}>Clear filters</button></div>
          : <div className="my-trips-grid">
            {filteredTrips.map((item) => {
              const status = getTripStatus(item);
              const cover = getCover(item.destination);
              const selected = selectedTripId === item.id;
              return (
                <article className={`my-trips-card${selected ? " my-trips-card-selected" : ""}${item.archived ? " my-trips-card-archived" : ""}`} key={item.id}>
                  <div className={`my-trips-cover my-trips-cover-${cover.theme}`}>
                    <span className="my-trips-cover-emoji" aria-hidden="true">{cover.emoji}</span>
                    <span className={`my-trips-status my-trips-status-${status.toLowerCase()}`}>{status}</span>
                    {selected && <span className="my-trips-current">✓ Current trip</span>}
                      {item.archived && <span className="my-trips-archived-label">Archived</span>}
                    <span className="my-trips-cover-location">{item.destination || "Your next destination"}</span>
                  </div>
                  <div className="my-trips-card-body">
                    <h3>{item.name || "Untitled Trip"}</h3>
                    <p className="my-trips-card-detail">📍 {item.destination || "Destination not set"}</p>
                    <p className="my-trips-card-detail">📅 {formatDate(item.startDate)} — {formatDate(item.endDate)}</p>
                    <div className="my-trips-card-bottom"><div><span>TRIP BUDGET</span><strong>{money(item.budget)}</strong></div>
                      {!item.archived && <button className="my-trips-primary" type="button" onClick={() => onSelectTrip?.(item.id)}>{selected ? "Open trip ↗" : "View trip →"}</button>}
                    </div>
                    <div className="my-trips-card-management">
                      <button className="my-trips-manage-button" type="button" disabled={updatingTripId === item.id || (!item.archived && selected)} onClick={() => handleArchiveToggle(item)} title={!item.archived && selected ? "Switch to another trip before archiving this one" : undefined}>
                        {updatingTripId === item.id ? "Saving..." : item.archived ? "↩ Restore trip" : "▣ Archive trip"}
                      </button>
                      {!item.archived && selected && <small>Switch trips before archiving the current one.</small>}
                      <button className="my-trips-delete-link" type="button"
                        disabled={deleting || updatingTripId === item.id || selected}
                        title={selected ? "Switch to another trip before deleting this one" : "Permanently delete this trip"}
                        onClick={() => { setDeleteTarget(item); setDeleteConfirmation(""); setError(""); }}>
                        🗑 Delete trip
                      </button>
                      {selected && <small>Switch trips before deleting the current one.</small>}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>}
      </section>
      {deleteTarget && (
        <div className="my-trips-modal-overlay" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !deleting) setDeleteTarget(null);
        }}>
          <section className="my-trips-delete-modal" role="dialog" aria-modal="true"
            aria-labelledby="my-trips-delete-title" aria-describedby="my-trips-delete-description">
            <div className="my-trips-delete-symbol" aria-hidden="true">🗑️</div>
            <h2 id="my-trips-delete-title">Permanently delete trip?</h2>
            <p id="my-trips-delete-description">
              This will permanently delete <strong>{deleteTarget.name || "Untitled Trip"}</strong> and its known
              itinerary, expenses, places, checklist and travel info records. This cannot be undone.
            </p>
            <p className="my-trips-delete-warning">Back up your trip before continuing. This only deletes your personal trip, not group trips.</p>
            <form onSubmit={handleDelete}>
              <label className="my-trips-delete-label" htmlFor="my-trips-delete-confirm">
                Type <strong>{deleteTarget.name || "Untitled Trip"}</strong> to confirm
              </label>
              <input id="my-trips-delete-confirm" autoFocus autoComplete="off"
                value={deleteConfirmation} disabled={deleting}
                onChange={(event) => setDeleteConfirmation(event.target.value)} />
              <div className="my-trips-delete-actions">
                <button type="button" className="my-trips-secondary" disabled={deleting}
                  onClick={() => { setDeleteTarget(null); setDeleteConfirmation(""); }}>Cancel</button>
                <button type="submit" className="my-trips-delete-danger"
                  disabled={deleting || deleteConfirmation !== (deleteTarget.name || "Untitled Trip") || selectedTripId === deleteTarget.id}>
                  {deleting ? "Deleting..." : "Permanently delete"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}
