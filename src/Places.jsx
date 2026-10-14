

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
  runTransaction,

} from "firebase/firestore";



import { db, auth } from "./firebase";



const EMPTY_PLACE = {

  date: "",

  name: "",

  category: "Sightseeing",

  location: "",

  mapsUrl: "",

};



const CATEGORIES = ["Sightseeing", "Food", "Cafe", "Photo Spots", "Shopping", "Nature", "Other"];
const CATEGORY_ICONS = {
  Sightseeing: "🏯", Food: "🍜", Cafe: "☕", "Photo Spots": "📸",
  Shopping: "🛍️", Nature: "🌿", Other: "✨",
};
const categoryClass = (category) => String(category || "Other").toLowerCase().replace(/[^a-z0-9]+/g, "-");
const safeLink = (url) => {
  if (!url || typeof url !== "string") return "";
  try { const parsed = new URL(url); return ["http:", "https:"].includes(parsed.protocol) ? parsed.href : ""; }
  catch { return ""; }
};

function Places({

  trip,

  selectedTripId = null,

  dashboardMode,

  onDashboardModeChange,

  selectedGroupId: sharedSelectedGroupId,

  onSelectedGroupChange,

}) {

  const [places, setPlaces] = useState([]);

  const [loading, setLoading] = useState(true);

  const [saving, setSaving] = useState(false);
  const [itineraryPlace, setItineraryPlace] = useState(null);
  const [itineraryDate, setItineraryDate] = useState("");
  const [itineraryTime, setItineraryTime] = useState("09:00");
  const [itinerarySaving, setItinerarySaving] = useState(false);
  const [itineraryMessage, setItineraryMessage] = useState("");

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
  const [activeCategory, setActiveCategory] = useState("All");
  const [searchTerm, setSearchTerm] = useState("");



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
    setPlaces([]);

    setError("");



    const placesRef =

      mode === "group"

        ? collection(db, "groups", selectedGroupId, "places")

        : collection(db, "users", auth.currentUser.uid, ...(selectedTripId ? ["trips", selectedTripId] : []), "places");



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

  }, [mode, selectedGroupId, selectedTripId]);



  // Prevent an open edit form from carrying into another personal trip.
  useEffect(() => {
    setItineraryPlace(null);
    setItineraryMessage("");
    setShowForm(false);
    setEditingId(null);
    setNewPlace({ ...EMPTY_PLACE, date: trip?.startDate || "" });
  }, [selectedTripId]);

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
    setItineraryPlace(null);
    setItineraryMessage("");

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
    setItineraryPlace(null);
    setItineraryMessage("");

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



    if ((newPlace.inspirationUrl.trim() && !safeLink(newPlace.inspirationUrl.trim())) || (newPlace.mapsUrl.trim() && !safeLink(newPlace.mapsUrl.trim()))) { setError("Please use a valid http(s) URL."); return; }
    setSaving(true);

    setError("");



    try {

      const placesRef =

        mode === "group"

          ? collection(db, "groups", selectedGroupId, "places")

          : collection(db, "users", auth.currentUser.uid, ...(selectedTripId ? ["trips", selectedTripId] : []), "places");



      const placeData = {

        date: newPlace.date,

        name: newPlace.name.trim(),

        category: newPlace.category,

        location: newPlace.location.trim(),

        mapsUrl: newPlace.mapsUrl.trim(),
        inspirationUrl: newPlace.inspirationUrl.trim(),
        notes: newPlace.notes.trim(),

      };



      if (editingId !== null) {

        const placeRef = doc(db, ...(mode === "group" ? ["groups", selectedGroupId] : ["users", auth.currentUser.uid, ...(selectedTripId ? ["trips", selectedTripId] : [])]), "places", editingId);



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
      inspirationUrl: place.inspirationUrl || "",
      notes: place.notes || "",

    });



    setEditingId(place.id);

    setShowForm(true);

    setError("");

  };



  // Step 2.5B: Save an inspiration as an activity in the SAME trip/group.
  const itineraryTripStart = mode === "group"
    ? selectedGroup?.tripSettings?.startDate || ""
    : trip?.startDate || "";
  const itineraryTripEnd = mode === "group"
    ? selectedGroup?.tripSettings?.endDate || ""
    : trip?.endDate || "";

  const openItineraryForm = (place) => {
    setItineraryPlace(place);
    const preferred = place.date || "";
    setItineraryDate(preferred >= itineraryTripStart && preferred <= itineraryTripEnd
      ? preferred : itineraryTripStart);
    setItineraryTime("09:00");
    setItineraryMessage("");
  };

  const addToItinerary = async (event) => {
    event.preventDefault();
    const currentUser = auth.currentUser;
    if (!currentUser || !itineraryPlace) return;
    if (mode === "group" && !selectedGroupId) {
      setItineraryMessage("Please select a group first."); return;
    }
    if (!itineraryTripStart || !itineraryTripEnd || itineraryDate < itineraryTripStart || itineraryDate > itineraryTripEnd) {
      setItineraryMessage("Choose a date within your trip dates."); return;
    }
    if (!itineraryTime) { setItineraryMessage("Please select a time."); return; }
    setItinerarySaving(true);
    setItineraryMessage("");
    try {
      const activitiesRef = mode === "group"
        ? collection(db, "groups", selectedGroupId, "activities")
        : collection(db, "users", currentUser.uid, ...(selectedTripId ? ["trips", selectedTripId] : []), "activities");
      // Stable ID + transaction prevent simultaneous duplicate additions.
      const activityRef = doc(activitiesRef, `inspiration_${itineraryPlace.id}`);
      const place = itineraryPlace;
      const noteParts = [place.notes || ""];
      if (safeLink(place.inspirationUrl)) noteParts.push(`Inspiration: ${safeLink(place.inspirationUrl)}`);
      if (safeLink(place.mapsUrl)) noteParts.push(`Google Maps: ${safeLink(place.mapsUrl)}`);
      const result = await runTransaction(db, async (transaction) => {
        const existing = await transaction.get(activityRef);
        if (existing.exists()) return "duplicate";
        transaction.set(activityRef, {
          date: itineraryDate,
          time: itineraryTime,
          title: place.name || "Saved place",
          location: place.location || "",
          notes: noteParts.filter(Boolean).join("\n"),
          sourcePlaceId: place.id,
          sourceCategory: place.category || "Other",
          createdBy: currentUser.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        return "created";
      });
      if (result === "duplicate") {
        setItineraryMessage("Already in this trip's itinerary. You can edit its date/time in Itinerary.");
      } else {
        setItineraryPlace(null);
        setItineraryMessage(`Added to Itinerary for ${itineraryDate} at ${itineraryTime}!`);
      }
    } catch (err) {
      console.error("Failed to add inspiration to itinerary:", err);
      setItineraryMessage(`Unable to add to itinerary (${err.code || "unknown error"}).`);
    } finally {
      setItinerarySaving(false);
    }
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

      const placeRef = doc(db, ...(mode === "group" ? ["groups", selectedGroupId] : ["users", auth.currentUser.uid, ...(selectedTripId ? ["trips", selectedTripId] : [])]), "places", id);



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

      const placeRef = doc(db, ...(mode === "group" ? ["groups", selectedGroupId] : ["users", auth.currentUser.uid, ...(selectedTripId ? ["trips", selectedTripId] : [])]), "places", place.id);



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

    return CATEGORY_ICONS[category] || "✨";

  };



  const filteredPlaces = places.filter((place) => (activeCategory === "All" || place.category === activeCategory) && `${place.name || ""} ${place.location || ""} ${place.notes || ""}`.toLowerCase().includes(searchTerm.toLowerCase().trim()));
  const sortedPlaces = [...filteredPlaces].sort((a, b) =>

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

          <h1>Travel Inspiration</h1>
          <span className="inspiration-subtitle">Save ideas now, plan the itinerary later.</span>

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

          👤 Personal Inspiration

        </button>



        <button

          className={mode === "group" ? "active" : ""}

          onClick={() => handleModeChange("group")}

        >

          👥 Group Inspiration

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

          <h2>{editingId !== null ? "Edit Inspiration" : "Save Inspiration"}</h2>

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

            <label className="place-field-wide">Instagram / TikTok / YouTube / Blog Link
              <input type="url" name="inspirationUrl" value={newPlace.inspirationUrl} onChange={handleChange} placeholder="https://..." />
            </label>
            <label className="place-field-wide">Notes / Why save this place?
              <textarea name="notes" value={newPlace.notes} onChange={handleChange} placeholder="Must-try dish, photo angle, opening hours..." rows={3} maxLength={1500} />
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



      {itineraryMessage && !itineraryPlace && <p className="inspiration-itinerary-feedback" role="status">{itineraryMessage}</p>}
      {itineraryPlace && (
        <div className="inspiration-itinerary-overlay" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget && !itinerarySaving) setItineraryPlace(null); }}>
          <form className="inspiration-itinerary-dialog" onSubmit={addToItinerary} aria-label="Add place to itinerary">
            <h2>📅 Add to Itinerary</h2>
            <p className="inspiration-itinerary-name">{getCategoryIcon(itineraryPlace.category)} {itineraryPlace.name}</p>
            <p className="inspiration-itinerary-context">{mode === "group" ? `👥 ${selectedGroup?.tripSettings?.name || selectedGroup?.name || "Group Trip"}` : `👤 ${trip?.name || "Personal Trip"}`}</p>
            {!itineraryTripStart || !itineraryTripEnd || itineraryTripEnd < itineraryTripStart ? (
              <p className="places-error">Please set valid trip dates in Trip Settings or My Groups first.</p>
            ) : (
              <div className="inspiration-itinerary-fields">
                <label>Date <input type="date" required min={itineraryTripStart} max={itineraryTripEnd} value={itineraryDate} onChange={(e) => setItineraryDate(e.target.value)} /></label>
                <label>Time <input type="time" required value={itineraryTime} onChange={(e) => setItineraryTime(e.target.value)} /></label>
              </div>
            )}
            {itineraryMessage && <p className="inspiration-itinerary-error" role="alert">{itineraryMessage}</p>}
            <div className="inspiration-itinerary-buttons">
              <button type="button" disabled={itinerarySaving} onClick={() => { setItineraryPlace(null); setItineraryMessage(""); }}>Cancel</button>
              <button type="submit" disabled={itinerarySaving || !itineraryTripStart || !itineraryTripEnd || itineraryTripEnd < itineraryTripStart}>{itinerarySaving ? "Adding..." : "Add Activity"}</button>
            </div>
          </form>
        </div>
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



            <div className="inspiration-section-heading"><h2>{mode === "group" ? "Shared Inspiration" : "My Inspiration"}</h2><span>{filteredPlaces.length} shown</span></div>
            <div className="inspiration-tools">
              <input aria-label="Search inspiration" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder="🔎 Search places or notes..." />
              <div className="inspiration-filters" aria-label="Filter by category">
                {["All", ...CATEGORIES].map((category) => <button type="button" key={category} className={`inspiration-filter ${activeCategory === category ? "selected" : ""}`} onClick={() => setActiveCategory(category)}>{category === "All" ? "✨" : getCategoryIcon(category)} {category} <span>{category === "All" ? places.length : places.filter((p) => p.category === category).length}</span></button>)}
              </div>
            </div>



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

              <div className="inspiration-grid">{sortedPlaces.map((place) => (

                <div

                  className={`place-card inspiration-${categoryClass(place.category)} ${place.visited ? "visited" : ""}`}

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



                    <span className={`place-category inspiration-tag inspiration-${categoryClass(place.category)}`}>{getCategoryIcon(place.category)} {place.category}</span>

                    <p className="place-location">📍 {place.location}</p>

                    {place.notes && <p className="inspiration-notes">{place.notes}</p>}
                    <p className="place-date">

                      📅 {formatDate(place.date)}

                    </p>



                    <div className="place-actions">

                      <button type="button" className="inspiration-add-itinerary" onClick={() => openItineraryForm(place)}>
                        + Add to Itinerary
                      </button>

                      <button onClick={() => handleEdit(place)}>

                        ✏️ Edit

                      </button>



                      <button onClick={() => handleToggleVisited(place)}>

                        {place.visited

                          ? "↩ Mark Unvisited"

                          : "✓ Mark Visited"}

                      </button>



                      {safeLink(place.inspirationUrl) && <a href={safeLink(place.inspirationUrl)} target="_blank" rel="noopener noreferrer">🔗 Inspiration</a>}
                      {place.mapsUrl && safeLink(place.mapsUrl) && (

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

              ))}</div>

            )}

          </>

        )}

      </main>

    </div>

  );

}



export default Places;