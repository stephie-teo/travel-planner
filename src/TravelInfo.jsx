

import { useEffect, useState } from "react";

import "./TravelInfo.css";



import {

  collection,

  doc,

  onSnapshot,

  query,

  where,

  setDoc,

  serverTimestamp,

} from "firebase/firestore";



import { db, auth } from "./firebase";



const DEFAULT_INFO = {

  transports: [],

  hotels: [],

  emergency: {

    police: "",

    ambulance: "",

    fire: "",

  },

  notes: "",

};



const EMPTY_HOTEL = {

  name: "",

  location: "",

  checkIn: "",

  checkOut: "",

  bookingRef: "",

};



const EMPTY_TRANSPORT = {

  type: "flight",

  from: "",

  to: "",

  date: "",

  time: "",

  bookingRef: "",

};



const TRANSPORT_TYPES = [

  { value: "flight", label: "✈️ Flight" },

  { value: "train", label: "🚄 Train" },

  { value: "bus", label: "🚌 Bus" },

  { value: "ferry", label: "⛴️ Ferry" },

  { value: "car", label: "🚗 Car" },

];



function TravelInfo({

  trip,
  selectedTripId = null,

  dashboardMode = "personal",

  selectedGroupId: homeSelectedGroupId = "",

  onSelectedGroupChange,

}) {

  const [mode, setMode] = useState(dashboardMode);

  const [groups, setGroups] = useState([]);

  const [selectedGroupId, setSelectedGroupId] = useState(

    homeSelectedGroupId

  );

  const [groupsLoading, setGroupsLoading] = useState(true);



  const [info, setInfo] = useState(null);

  const [loading, setLoading] = useState(true);

  const [editing, setEditing] = useState(false);

  const [saving, setSaving] = useState(false);

  const [error, setError] = useState("");



  const [showHotelForm, setShowHotelForm] = useState(false);

  const [editingHotelId, setEditingHotelId] = useState(null);

  const [newHotel, setNewHotel] = useState({ ...EMPTY_HOTEL });



  const [showTransportForm, setShowTransportForm] = useState(false);

  const [editingTransportId, setEditingTransportId] = useState(null);

  const [newTransport, setNewTransport] = useState({

    ...EMPTY_TRANSPORT,

  });



  const user = auth.currentUser;



  useEffect(() => {

  setMode(dashboardMode);

}, [dashboardMode]);



useEffect(() => {

  if (homeSelectedGroupId) {

    setSelectedGroupId(homeSelectedGroupId);

  }

}, [homeSelectedGroupId]);



  const selectedGroup = groups.find(

    (group) => group.id === selectedGroupId

  );



  // Load groups the current user belongs to.

  useEffect(() => {

    if (!user) {

      setGroups([]);

      setGroupsLoading(false);

      return;

    }



    const groupsQuery = query(

      collection(db, "groups"),

      where("memberIds", "array-contains", user.uid)

    );



    const unsubscribe = onSnapshot(

      groupsQuery,

      (snapshot) => {

        const loadedGroups = snapshot.docs.map((item) => ({

          id: item.id,

          ...item.data(),

        }));



        setGroups(loadedGroups);



        setSelectedGroupId((currentId) =>

          loadedGroups.some((group) => group.id === currentId)

            ? currentId

            : loadedGroups[0]?.id || ""

        );



        setGroupsLoading(false);

      },

      (err) => {

        console.error("Failed to load groups:", err);

        setError("Unable to load your groups. Check Firestore Rules.");

        setGroupsLoading(false);

      }

    );



    return () => unsubscribe();

  }, [user?.uid]);



  // Subscribe to personal or group travel information in real time.

  useEffect(() => {

    if (!user) {

      setInfo(null);

      setLoading(false);

      return;

    }



    if (mode === "group" && !selectedGroupId) {

      setInfo(null);

      setLoading(false);

      return;

    }



    setLoading(true);

    setError("");

    setInfo(null);

    setEditing(false);

    setEditingHotelId(null);

    setEditingTransportId(null);

    setShowHotelForm(false);

    setShowTransportForm(false);
    setNewHotel({ ...EMPTY_HOTEL });
    setNewTransport({ ...EMPTY_TRANSPORT });
    setSaving(false);

    const infoRef =

      mode === "group"

        ? doc(

            db,

            "groups",

            selectedGroupId,

            "travelInfo",

            "details"

          )

        : doc(

            db,

            "users",
              user.uid,
              ...(selectedTripId ? ["trips", selectedTripId] : []),
              "settings",
              "travelInfo"

          );



    const unsubscribe = onSnapshot(

      infoRef,

      async (snapshot) => {

        try {

          if (!snapshot.exists()) {
              // A new V2 trip starts with empty local info; never write defaults during loading.
              if (mode === "personal" && selectedTripId) {
                setInfo({
                  ...DEFAULT_INFO,
                  emergency: { ...DEFAULT_INFO.emergency },
                });
                setLoading(false);
                return;
              }

              const defaults = {

              ...DEFAULT_INFO,

              emergency: { ...DEFAULT_INFO.emergency },

            };



            // Initialize a new document only if it does not exist.

            // Existing personal data is not copied into a group.

            await setDoc(infoRef, {

              ...defaults,

              updatedAt: serverTimestamp(),

              updatedBy: user.uid,

            });



            return;

          }



          const data = snapshot.data();

          let normalized = {

            ...DEFAULT_INFO,

            ...data,

            emergency: {

              ...DEFAULT_INFO.emergency,

              ...(data.emergency || {}),

            },

            hotels: Array.isArray(data.hotels) ? data.hotels : [],

            transports: Array.isArray(data.transports)

              ? data.transports

              : [],

            notes: data.notes || "",

          };



          // Migrate legacy personal travel information only.

          if (mode === "personal") {

            let changed = false;



            if (data.hotel && !data.hotels) {

              normalized.hotels = [

                { id: Date.now(), ...data.hotel },

              ];

              delete normalized.hotel;

              changed = true;

            }



            if (data.flight && !data.transports && !data.flights) {

              normalized.transports = [

                { id: Date.now() + 1, ...data.flight, type: "flight" },

              ];

              delete normalized.flight;

              changed = true;

            }



            if (data.flights && !data.transports) {

              normalized.transports = data.flights.map(

                (flight, index) => ({

                  id: flight.id ?? Date.now() + index,

                  ...flight,

                  type: "flight",

                })

              );

              delete normalized.flights;

              changed = true;

            }



            if (changed) {

              await setDoc(infoRef, normalized);

              return;

            }

          }



          setInfo(normalized);

          setLoading(false);

        } catch (err) {

          console.error("Failed to process travel info:", err);

          setError("Unable to load travel information.");

          setLoading(false);

        }

      },

      (err) => {

        console.error("Failed to listen to travel info:", err);

        setError(

          "Unable to access travel information. Check your Firestore Rules."

        );

        setLoading(false);

      }

    );



    return () => unsubscribe();

  }, [user?.uid, mode, selectedGroupId, selectedTripId]);



  const getInfoRef = () => {

    if (!user) return null;



    if (mode === "group") {

      if (!selectedGroupId) return null;



      return doc(

        db,

        "groups",

        selectedGroupId,

        "travelInfo",

        "details"

      );

    }



    return doc(

      db,

      "users",
              user.uid,
              ...(selectedTripId ? ["trips", selectedTripId] : []),
              "settings",
              "travelInfo"

    );

  };



  const saveInfo = async (updatedInfo) => {

    const infoRef = getInfoRef();



    if (!user || !infoRef) {

      setError("Please select a group first.");

      return false;

    }



    setSaving(true);

    setError("");



    try {

      await setDoc(infoRef, {

        ...updatedInfo,

        updatedAt: serverTimestamp(),

        updatedBy: user.uid,

      });



      setInfo(updatedInfo);

      return true;

    } catch (err) {

      console.error("Failed to save travel information:", err);

      setError("Unable to save changes. Please check Firestore Rules.");

      return false;

    } finally {

      setSaving(false);

    }

  };



  const changeMode = (nextMode) => {

    setMode(nextMode);

    setError("");

    setEditing(false);

  };



  const handleGroupChange = (e) => {

    const nextGroupId = e.target.value;



    setSelectedGroupId(nextGroupId);

    onSelectedGroupChange?.(nextGroupId);

    setError("");

  };



  const handleEditToggle = async () => {

    if (!editing) {

      setEditing(true);

      return;

    }



    const success = await saveInfo(info);



    if (success) {

      setEditing(false);

    }

  };



  const updateField = (field, value) => {

    setInfo((prev) => ({ ...prev, [field]: value }));

  };



  const updateEmergency = (e) => {

    const { name, value } = e.target;



    setInfo((prev) => ({

      ...prev,

      emergency: {

        ...prev.emergency,

        [name]: value,

      },

    }));

  };



  const updateHotelField = (hotelId, field, value) => {

    setInfo((prev) => ({

      ...prev,

      hotels: prev.hotels.map((hotel) =>

        hotel.id === hotelId

          ? { ...hotel, [field]: value }

          : hotel

      ),

    }));

  };



  const updateTransportField = (transportId, field, value) => {

    setInfo((prev) => ({

      ...prev,

      transports: prev.transports.map((transport) =>

        transport.id === transportId

          ? { ...transport, [field]: value }

          : transport

      ),

    }));

  };



  const handleAddHotel = async () => {

    if (

      !newHotel.name.trim() ||

      !newHotel.location.trim() ||

      !newHotel.checkIn ||

      !newHotel.checkOut

    ) {

      setError("Please fill in all required hotel information.");

      return;

    }



    const updatedInfo = {

      ...info,

      hotels: [

        ...(info.hotels || []),

        { id: crypto.randomUUID(), ...newHotel },

      ],

    };



    if (await saveInfo(updatedInfo)) {

      setNewHotel({ ...EMPTY_HOTEL });

      setShowHotelForm(false);

    }

  };



  const handleDeleteHotel = async (hotelId) => {

    if (!window.confirm("Are you sure you want to delete this hotel?")) {

      return;

    }



    const updatedInfo = {

      ...info,

      hotels: info.hotels.filter((hotel) => hotel.id !== hotelId),

    };



    if (await saveInfo(updatedInfo)) {

      setEditingHotelId(null);

    }

  };



  const handleAddTransport = async () => {

    if (

      !newTransport.from.trim() ||

      !newTransport.to.trim() ||

      !newTransport.date ||

      !newTransport.time

    ) {

      setError("Please fill in all required transport information.");

      return;

    }



    const updatedInfo = {

      ...info,

      transports: [

        ...(info.transports || []),

        { id: crypto.randomUUID(), ...newTransport },

      ],

    };



    if (await saveInfo(updatedInfo)) {

      setNewTransport({ ...EMPTY_TRANSPORT });

      setShowTransportForm(false);

    }

  };



  const handleDeleteTransport = async (transportId) => {

    if (

      !window.confirm("Are you sure you want to delete this transport?")

    ) {

      return;

    }



    const updatedInfo = {

      ...info,

      transports: info.transports.filter(

        (transport) => transport.id !== transportId

      ),

    };



    if (await saveInfo(updatedInfo)) {

      setEditingTransportId(null);

    }

  };



  const formatDate = (dateString) => {

    if (!dateString) return "-";



    const date = new Date(`${dateString}T00:00:00`);



    if (Number.isNaN(date.getTime())) return "-";



    return date.toLocaleDateString("en-GB", {

      day: "2-digit",

      month: "short",

      year: "numeric",

    });

  };



  if (loading || (mode === "group" && groupsLoading)) {

    return (

      <div className="travel-info-page">

        <div className="empty-state">

          <span>✈️</span>

          <p>Loading travel information...</p>

        </div>

      </div>

    );

  }



  return (

    <div className="travel-info-page">

      <header className="travel-info-header">

        <div>

          <p>

            ✈️{" "}

        {mode === "group"

          ? selectedGroup?.tripSettings?.name ||

            selectedGroup?.name ||

            "Group Trip"

          : trip?.name || "My Trip"}

          </p>

          <h1>Travel Info</h1>

        </div>



        {info && (

          <button

            className="edit-info-button"

            onClick={handleEditToggle}

            disabled={saving}

          >

            {saving ? "Saving..." : editing ? "Done" : "Edit"}

          </button>

        )}

      </header>



      <div className="travel-info-mode-switch">

        <button

          className={mode === "personal" ? "active" : ""}

          onClick={() => changeMode("personal")}

        >

          👤 Personal

        </button>

        <button

          className={mode === "group" ? "active" : ""}

          onClick={() => changeMode("group")}

        >

          👥 Group

        </button>

      </div>



      {mode === "group" && (

        <div className="travel-info-group-selector">

          <label htmlFor="travel-info-group">Select Group</label>

          {groups.length > 0 ? (

            <select

              id="travel-info-group"

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

            <p>You have not joined any groups yet. Create or join a group first.</p>

          )}

        </div>

      )}



      {error && (

        <p className="travel-info-error" role="alert">

          {error}

        </p>

      )}



      {!info ? (

        <div className="travel-info-content">

          <div className="empty-state">

            <span>🧳</span>

            <p>

              {mode === "group" && !selectedGroupId

                ? "Select a group to view its travel information."

                : "Travel information is unavailable."}

            </p>

          </div>

        </div>

      ) : (

        <main className="travel-info-content">

          {/* Transport */}

          <section className="info-card">

            <div className="info-card-title">

              <div className="info-card-heading">

                <span>🚆</span>

                <h2>Transport</h2>

              </div>



              {editing && (

                <button

                  className="add-transport-button"

                  onClick={() => setShowTransportForm(!showTransportForm)}

                >

                  + Add Transport

                </button>

              )}

            </div>



            {editing && showTransportForm && (

              <div className="info-form">

                <label>

                  Transport Type

                  <select

                    value={newTransport.type}

                    onChange={(e) =>

                      setNewTransport({

                        ...newTransport,

                        type: e.target.value,

                      })

                    }

                  >

                    {TRANSPORT_TYPES.map((type) => (

                      <option key={type.value} value={type.value}>

                        {type.label}

                      </option>

                    ))}

                  </select>

                </label>



                {[

                  ["from", "From"],

                  ["to", "To"],

                  ["date", "Date"],

                  ["time", "Time"],

                  ["bookingRef", "Booking Reference"],

                ].map(([field, label]) => (

                  <label key={field}>

                    {label}

                    <input

                      type={

                        field === "date"

                          ? "date"

                          : field === "time"

                            ? "time"

                            : "text"

                      }

                      value={newTransport[field]}

                      onChange={(e) =>

                        setNewTransport({

                          ...newTransport,

                          [field]: e.target.value,

                        })

                      }

                    />

                  </label>

                ))}



                <button

                  className="save-transport-button"

                  onClick={handleAddTransport}

                  disabled={saving}

                >

                  Save Transport

                </button>

              </div>

            )}



            {info.transports.length === 0 ? (

              <p>No transport added yet.</p>

            ) : (

              info.transports.map((transport) => (

                <div className="transport-item" key={transport.id}>

                  {editingTransportId === transport.id && editing ? (

                    <div className="info-form">

                      <label>

                        Transport Type

                        <select

                          value={transport.type || "flight"}

                          onChange={(e) =>

                            updateTransportField(

                              transport.id,

                              "type",

                              e.target.value

                            )

                          }

                        >

                          {TRANSPORT_TYPES.map((type) => (

                            <option key={type.value} value={type.value}>

                              {type.label}

                            </option>

                          ))}

                        </select>

                      </label>



                      {[

                        ["from", "From"],

                        ["to", "To"],

                        ["date", "Date"],

                        ["time", "Time"],

                        ["bookingRef", "Booking Reference"],

                      ].map(([field, label]) => (

                        <label key={field}>

                          {label}

                          <input

                            type={

                              field === "date"

                                ? "date"

                                : field === "time"

                                  ? "time"

                                  : "text"

                            }

                            value={transport[field] || ""}

                            onChange={(e) =>

                              updateTransportField(

                                transport.id,

                                field,

                                e.target.value

                              )

                            }

                          />

                        </label>

                      ))}



                      <div className="transport-edit-actions">

                        <button

                          className="save-transport-button"

                          disabled={saving}

                          onClick={async () => {

                            if (await saveInfo(info)) {

                              setEditingTransportId(null);

                            }

                          }}

                        >

                          Save Changes

                        </button>

                        <button

                          className="cancel-transport-button"

                          onClick={() => setEditingTransportId(null)}

                        >

                          Cancel

                        </button>

                      </div>

                    </div>

                  ) : (

                    <>

                      <div className="transport-title-row">

                        <div className="transport-type">

                          {TRANSPORT_TYPES.find(

                            (type) => type.value === transport.type

                          )?.label || "🚆 Transport"}

                        </div>



                        <div className="transport-route">

                          <div>

                            <strong>{transport.from || "-"}</strong>

                            <small>Departure</small>

                          </div>

                          <span>→</span>

                          <div>

                            <strong>{transport.to || "-"}</strong>

                            <small>Destination</small>

                          </div>

                        </div>



                        {editing && (

                          <div className="transport-actions">

                            <button

                              className="edit-transport-button"

                              onClick={() =>

                                setEditingTransportId(transport.id)

                              }

                            >

                              Edit

                            </button>

                            <button

                              className="delete-transport-button"

                              onClick={() =>

                                handleDeleteTransport(transport.id)

                              }

                              disabled={saving}

                            >

                              Delete

                            </button>

                          </div>

                        )}

                      </div>



                      <div className="info-row">

                        <span>📅 Date</span>

                        <strong>{formatDate(transport.date)}</strong>

                      </div>

                      <div className="info-row">

                        <span>🕐 Time</span>

                        <strong>{transport.time || "-"}</strong>

                      </div>

                      <div className="info-row">

                        <span>🎫 Booking Ref</span>

                        <strong>{transport.bookingRef || "-"}</strong>

                      </div>

                    </>

                  )}

                </div>

              ))

            )}

          </section>



          {/* Hotels */}

          <section className="info-card">

            <div className="info-card-title">

              <div className="info-card-heading">

                <span>🏨</span>

                <h2>Hotels</h2>

              </div>



              {editing && (

                <button

                  className="add-hotel-button"

                  onClick={() => setShowHotelForm(!showHotelForm)}

                >

                  + Add Hotel

                </button>

              )}

            </div>



            {editing && showHotelForm && (

              <div className="info-form">

                {[

                  ["name", "Hotel Name", "text"],

                  ["location", "Location", "text"],

                  ["checkIn", "Check-in", "date"],

                  ["checkOut", "Check-out", "date"],

                  ["bookingRef", "Booking Reference", "text"],

                ].map(([field, label, type]) => (

                  <label key={field}>

                    {label}

                    <input

                      type={type}

                      value={newHotel[field]}

                      onChange={(e) =>

                        setNewHotel({

                          ...newHotel,

                          [field]: e.target.value,

                        })

                      }

                    />

                  </label>

                ))}



                <button

                  className="save-hotel-button"

                  onClick={handleAddHotel}

                  disabled={saving}

                >

                  Save Hotel

                </button>

              </div>

            )}



            {info.hotels.length === 0 ? (

              <p>No hotels added yet.</p>

            ) : (

              info.hotels.map((hotel) => (

                <div className="hotel-item" key={hotel.id}>

                  {editingHotelId === hotel.id && editing ? (

                    <div className="info-form">

                      {[

                        ["name", "Hotel Name", "text"],

                        ["location", "Location", "text"],

                        ["checkIn", "Check-in", "date"],

                        ["checkOut", "Check-out", "date"],

                        ["bookingRef", "Booking Reference", "text"],

                      ].map(([field, label, type]) => (

                        <label key={field}>

                          {label}

                          <input

                            type={type}

                            value={hotel[field] || ""}

                            onChange={(e) =>

                              updateHotelField(

                                hotel.id,

                                field,

                                e.target.value

                              )

                            }

                          />

                        </label>

                      ))}



                      <div className="hotel-edit-actions">

                        <button

                          className="save-hotel-button"

                          disabled={saving}

                          onClick={async () => {

                            if (await saveInfo(info)) {

                              setEditingHotelId(null);

                            }

                          }}

                        >

                          Save Changes

                        </button>

                        <button

                          className="cancel-hotel-button"

                          onClick={() => setEditingHotelId(null)}

                        >

                          Cancel

                        </button>

                      </div>

                    </div>

                  ) : (

                    <>

                      <div className="hotel-title-row">

                        <h3 className="hotel-name">{hotel.name}</h3>

                        {editing && (

                          <div className="hotel-actions">

                            <button

                              className="edit-hotel-button"

                              onClick={() =>

                                setEditingHotelId(hotel.id)

                              }

                            >

                              Edit

                            </button>

                            <button

                              className="delete-hotel-button"

                              disabled={saving}

                              onClick={() => handleDeleteHotel(hotel.id)}

                            >

                              Delete

                            </button>

                          </div>

                        )}

                      </div>



                      <p className="hotel-location">

                        📍 {hotel.location}

                      </p>

                      <div className="info-row">

                        <span>Check-in</span>

                        <strong>{formatDate(hotel.checkIn)}</strong>

                      </div>

                      <div className="info-row">

                        <span>Check-out</span>

                        <strong>{formatDate(hotel.checkOut)}</strong>

                      </div>

                      <div className="info-row">

                        <span>🎫 Booking Ref</span>

                        <strong>{hotel.bookingRef || "-"}</strong>

                      </div>

                    </>

                  )}

                </div>

              ))

            )}

          </section>



          {/* Emergency Contacts */}

          <section className="info-card">

            <div className="info-card-title">

              <span>📞</span>

              <h2>Emergency Contacts</h2>

            </div>



            {editing ? (

              <div className="info-form">

                {[

                  ["police", "Police"],

                  ["ambulance", "Ambulance"],

                  ["fire", "Fire"],

                ].map(([field, label]) => (

                  <label key={field}>

                    {label}

                    <input

                      name={field}

                      value={info.emergency[field] || ""}

                      onChange={updateEmergency}

                    />

                  </label>

                ))}

              </div>

            ) : (

              <div className="emergency-list">

                {[

                  ["👮 Police", info.emergency.police],

                  ["🚑 Ambulance", info.emergency.ambulance],

                  ["🔥 Fire", info.emergency.fire],

                ].map(([label, value]) => (

                  <div key={label}>

                    <span>{label}</span>

                    <strong>{value || "-"}</strong>

                  </div>

                ))}

              </div>

            )}

          </section>



          {/* Important Notes */}

          <section className="info-card">

            <div className="info-card-title">

              <span>📝</span>

              <h2>Important Notes</h2>

            </div>



            {editing ? (

              <textarea

                className="notes-input"

                value={info.notes}

                onChange={(e) => updateField("notes", e.target.value)}

                placeholder="Add important travel notes..."

              />

            ) : (

              <div className="notes-display">

                {(info.notes || "").split("\n").map((note, index) => (

                  <p key={index}>{note || "\u00A0"}</p>

                ))}

              </div>

            )}

          </section>

        </main>

      )}

    </div>

  );

}



export default TravelInfo;