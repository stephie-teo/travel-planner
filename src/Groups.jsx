
import { useEffect, useState } from "react";
import { auth, db } from "./firebase";

import {
  addDoc,
  arrayUnion,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
  setDoc,
  deleteDoc,
  writeBatch,
} from "firebase/firestore";

import "./Groups.css";

function generateInviteCode() {
  const characters = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const randomValues = crypto.getRandomValues(new Uint8Array(10));

  return Array.from(randomValues)
    .map((value) => characters[value % characters.length])
    .join("");
}

function getFallbackName(user) {
  if (user?.displayName?.trim()) {
    return user.displayName.trim();
  }

  if (user?.email) {
    return user.email.split("@")[0];
  }

  return "Member";
}

function getDefaultTrip(groupName = "") {
  return {
    name: groupName,
    destination: "",
    startDate: "",
    endDate: "",
    budget: 0,
  };
}

function Groups() {
  const [groups, setGroups] = useState([]);
  const [selectedGroup, setSelectedGroup] = useState(null);

  const [groupName, setGroupName] = useState("");
  const [joinCode, setJoinCode] = useState("");

  const [tripSettings, setTripSettings] = useState(
    getDefaultTrip()
  );

  const [showForm, setShowForm] = useState(false);
  const [showJoinForm, setShowJoinForm] = useState(false);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [deleting, setDeleting] = useState(false);

  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const user = auth.currentUser;

  const isOwner =
    selectedGroup?.ownerId === user?.uid;

  // Load groups and member profiles.
  const loadGroups = async () => {
    if (!auth.currentUser) {
      setGroups([]);
      setSelectedGroup(null);
      setLoading(false);
      setError("Please sign in to view your groups.");
      return;
    }

    const currentUser = auth.currentUser;

    setLoading(true);

    try {
      // Ensure the current user has a profile document.
      const ownProfileRef = doc(
        db,
        "userProfiles",
        currentUser.uid
      );

      const ownProfileSnap = await getDoc(ownProfileRef);

      if (!ownProfileSnap.exists()) {
        await setDoc(ownProfileRef, {
          displayName: getFallbackName(currentUser),
          email: currentUser.email || "",
          createdAt: serverTimestamp(),
        });
      }

      const groupsRef = collection(db, "groups");

      const groupQuery = query(
        groupsRef,
        where("memberIds", "array-contains", currentUser.uid)
      );

      const snapshot = await getDocs(groupQuery);

      const loadedGroups = await Promise.all(
        snapshot.docs.map(async (item) => {
          const group = {
            id: item.id,
            ...item.data(),
          };

          const memberIds = group.memberIds || [];

          const memberEntries = await Promise.all(
            memberIds.map(async (memberId) => {
              try {
                const profileSnap = await getDoc(
                  doc(db, "userProfiles", memberId)
                );

                if (profileSnap.exists()) {
                  const profile = profileSnap.data();

                  return [
                    memberId,
                    profile.displayName ||
                      profile.email?.split("@")[0] ||
                      `Member ${memberId.slice(-6)}`,
                  ];
                }
              } catch (profileError) {
                console.error(
                  `Could not load profile for ${memberId}:`,
                  profileError
                );
              }

              return [
                memberId,
                memberId === currentUser.uid
                  ? getFallbackName(currentUser)
                  : `Member ${memberId.slice(-6)}`,
              ];
            })
          );

          return {
            ...group,
            memberNames: Object.fromEntries(memberEntries),
          };
        })
      );

      setGroups(loadedGroups);

      setSelectedGroup((previous) => {
        if (!previous) return null;

        return (
          loadedGroups.find(
            (group) => group.id === previous.id
          ) || null
        );
      });

      setError("");
    } catch (err) {
      console.error("Failed to load groups:", err);

      setError(
        `Unable to load groups (${err.code || "unknown error"}). Check your Firestore Rules.`
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadGroups();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Populate the shared settings when opening or refreshing a group.
  useEffect(() => {
    if (!selectedGroup) {
      setTripSettings(getDefaultTrip());
      return;
    }

    setTripSettings({
      ...getDefaultTrip(selectedGroup.name),
      ...(selectedGroup.tripSettings || {}),
      budget: Number(
        selectedGroup.tripSettings?.budget ?? 0
      ),
    });
  }, [selectedGroup]);

  // Create a new group with shared trip settings.
  const handleCreateGroup = async (event) => {
    event.preventDefault();

    if (!auth.currentUser || !groupName.trim()) return;

    setSaving(true);
    setError("");
    setMessage("");

    try {
      let inviteCode = "";
      let inviteRef = null;

      for (let attempt = 0; attempt < 5; attempt++) {
        const candidate = generateInviteCode();

        const candidateRef = doc(
          db,
          "groupInvites",
          candidate
        );

        const existingInvite = await getDoc(candidateRef);

        if (!existingInvite.exists()) {
          inviteCode = candidate;
          inviteRef = candidateRef;
          break;
        }
      }

      if (!inviteCode || !inviteRef) {
        throw new Error(
          "Could not generate a unique invite code."
        );
      }

      const newGroupName = groupName.trim();

      const groupRef = await addDoc(
        collection(db, "groups"),
        {
          name: newGroupName,
          ownerId: auth.currentUser.uid,
          memberIds: [auth.currentUser.uid],
          inviteCode,
          createdAt: serverTimestamp(),

          // Shared settings for everyone in this group.
          tripSettings: getDefaultTrip(newGroupName),
        }
      );

      await setDoc(inviteRef, {
        code: inviteCode,
        groupId: groupRef.id,
        createdBy: auth.currentUser.uid,
        createdAt: serverTimestamp(),
      });

      setGroupName("");
      setShowForm(false);

      setMessage(
        `Group created! Invite code: ${inviteCode}`
      );

      await loadGroups();
    } catch (err) {
      console.error("Failed to create group:", err);

      setError(
        `Unable to create group (${err.code || "unknown error"}). Please try again.`
      );
    } finally {
      setSaving(false);
    }
  };

  // Join an existing group using an invite code.
  const handleJoinGroup = async (event) => {
    event.preventDefault();

    if (!auth.currentUser || !joinCode.trim()) return;

    setSaving(true);
    setError("");
    setMessage("");

    try {
      const normalizedCode = joinCode.trim().toUpperCase();

      const inviteRef = doc(
        db,
        "groupInvites",
        normalizedCode
      );

      const inviteSnap = await getDoc(inviteRef);

      if (!inviteSnap.exists()) {
        setError(
          "Invalid invite code. Please check and try again."
        );
        return;
      }

      const invite = inviteSnap.data();

      if (
        invite.code !== normalizedCode ||
        !invite.groupId
      ) {
        setError("This invite code is invalid.");
        return;
      }

      const groupRef = doc(db, "groups", invite.groupId);

      await updateDoc(groupRef, {
        memberIds: arrayUnion(auth.currentUser.uid),
      });

      setJoinCode("");
      setShowJoinForm(false);
      setMessage("You have joined the group!");

      await loadGroups();
    } catch (err) {
      console.error("Failed to join group:", err);

      if (err.code === "permission-denied") {
        setError(
          "Permission denied. Please check the published Firestore Rules and invite code."
        );
      } else {
        setError(
          `Unable to join group (${err.code || "unknown error"}). Please try again.`
        );
      }
    } finally {
      setSaving(false);
    }
  };

  // Update a field in the shared trip settings.
  const handleTripChange = (event) => {
    const { name, value } = event.target;

    setTripSettings((previous) => ({
      ...previous,
      [name]: name === "budget" ? value : value,
    }));

    setError("");
    setMessage("");
  };

  // Save shared trip settings to the group document.
  const handleSaveTripSettings = async (event) => {
    event.preventDefault();

    if (!selectedGroup || !auth.currentUser) {
      setError("Please sign in and select a group.");
      return;
    }

    if (selectedGroup.ownerId !== auth.currentUser.uid) {
      setError("Only the group owner can edit trip settings.");
      return;
    }

    if (!tripSettings.name.trim()) {
      setError("Please enter a trip name.");
      return;
    }

    if (!tripSettings.destination.trim()) {
      setError("Please enter a destination.");
      return;
    }

    if (!tripSettings.startDate || !tripSettings.endDate) {
      setError("Please select both start and end dates.");
      return;
    }

    if (tripSettings.endDate < tripSettings.startDate) {
      setError("End date cannot be earlier than start date.");
      return;
    }

    const budget = Number(tripSettings.budget);

    if (!Number.isFinite(budget) || budget < 0) {
      setError("Please enter a valid budget of RM0 or more.");
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");

    try {
      const groupRef = doc(
        db,
        "groups",
        selectedGroup.id
      );

      const sharedSettings = {
        name: tripSettings.name.trim(),
        destination: tripSettings.destination.trim(),
        startDate: tripSettings.startDate,
        endDate: tripSettings.endDate,
        budget,
      };

      await updateDoc(groupRef, {
        tripSettings: sharedSettings,
      });

      const updatedGroup = {
        ...selectedGroup,
        tripSettings: sharedSettings,
      };

      setSelectedGroup(updatedGroup);

      setGroups((previous) =>
        previous.map((group) =>
          group.id === selectedGroup.id
            ? { ...group, tripSettings: sharedSettings }
            : group
        )
      );

      setMessage("Shared trip settings saved successfully!");
    } catch (err) {
      console.error("Failed to save shared trip settings:", err);

      if (err.code === "permission-denied") {
        setError(
          "Permission denied. Please confirm the Firestore Rules are published and you are the group owner."
        );
      } else {
        setError(
          `Unable to save trip settings (${err.code || "unknown error"}). Please try again.`
        );
      }
    } finally {
      setSaving(false);
    }
  };

  const handleCopyCode = async (code) => {
    try {
      await navigator.clipboard.writeText(code);

      setMessage("Invite code copied!");
      setError("");
    } catch (err) {
      console.error("Failed to copy invite code:", err);

      setMessage(`Invite code: ${code}`);
      setError("");
    }
  };

  // Delete a group and its shared data.
// Only the group owner can perform this action.
const handleDeleteGroup = async () => {
  if (!selectedGroup || !auth.currentUser) {
    setError("Please sign in and select a group.");
    return;
  }

  if (selectedGroup.ownerId !== auth.currentUser.uid) {
    setError("Only the group owner can delete this group.");
    return;
  }

  const confirmed = window.confirm(
    `Delete "${selectedGroup.name}" permanently?\n\n` +
      "This will delete the group's shared itinerary, expenses, " +
      "checklist, places, travel information, and invite code.\n\n" +
      "This action cannot be undone. Your personal travel data " +
      "will not be deleted."
  );

  if (!confirmed) return;

  setDeleting(true);
  setError("");
  setMessage("");

  const groupId = selectedGroup.id;

  try {
    // Clean up all known shared subcollections first.
    // Keep the parent group document until its children are removed,
    // because the Firestore Rules check group membership.
    const subcollections = [
      "activities",
      "expenses",
      "checklist",
      "places",
      "travelInfo",
    ];

    for (const subcollectionName of subcollections) {
      const childCollectionRef = collection(
        db,
        "groups",
        groupId,
        subcollectionName
      );

      const childSnapshot = await getDocs(childCollectionRef);

      // Firestore batches have a 500-write limit.
      // Use smaller batches to leave room for future changes.
      const documents = childSnapshot.docs;

      for (let i = 0; i < documents.length; i += 400) {
        const batch = writeBatch(db);
        const chunk = documents.slice(i, i + 400);

        chunk.forEach((childDoc) => {
          batch.delete(childDoc.ref);
        });

        await batch.commit();
      }
    }

    // Remove the invitation document, if one exists.
    if (selectedGroup.inviteCode) {
      const inviteRef = doc(
        db,
        "groupInvites",
        selectedGroup.inviteCode
      );

      const inviteSnapshot = await getDoc(inviteRef);

      if (inviteSnapshot.exists()) {
        await deleteDoc(inviteRef);
      }
    }

    // Delete the group document last.
    await deleteDoc(doc(db, "groups", groupId));

    setGroups((previous) =>
      previous.filter((group) => group.id !== groupId)
    );

    setSelectedGroup(null);
    setTripSettings(getDefaultTrip());
    setMessage(`"${selectedGroup.name}" was deleted successfully.`);
  } catch (err) {
    console.error("Failed to delete group:", err);

    setError(
      `Unable to fully delete this group (${err.code || "unknown error"}). ` +
        "Some shared data may already have been removed. " +
        "Check your Firestore Rules and try again."
    );
  } finally {
    setDeleting(false);
  }
};

  const openGroup = (group) => {
    setSelectedGroup(group);
    setMessage("");
    setError("");
  };

  const formatDate = (dateString) => {
    if (!dateString) return "Not set";

    const date = new Date(`${dateString}T00:00:00`);

    return date.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  };

  return (
    <div className="groups-page">
      {selectedGroup ? (
        <>
        <div className="group-header-actions">
          <button
            type="button"
            className="create-group-button"
            disabled={deleting}
            onClick={() => {
              setSelectedGroup(null);
              setMessage("");
              setError("");
            }}
          >
            ← Back to Groups
          </button>

          {isOwner && (
            <button
              type="button"
              className="delete-group-button"
              onClick={handleDeleteGroup}
              disabled={deleting || saving}
            >
              {deleting ? "Deleting..." : "Delete Group"}
            </button>
          )}
        </div>

          <main className="groups-content">
            {message && (
              <p className="groups-message">{message}</p>
            )}

            {error && (
              <p className="groups-error">{error}</p>
            )}

            {/* Shared trip settings */}
            <section className="group-form">
              <h2>✈️ Shared Trip Settings</h2>

              <p>
                Everyone in this group shares the same trip details.
              </p>

              {!isOwner && (
                <p>
                  You are viewing the trip settings. Only the group
                  owner can make changes.
                </p>
              )}

              <form onSubmit={handleSaveTripSettings}>
                <label htmlFor="sharedTripName">
                  Trip Name
                </label>

                <input
                  id="sharedTripName"
                  type="text"
                  name="name"
                  value={tripSettings.name}
                  onChange={handleTripChange}
                  placeholder="e.g. Japan Holiday"
                  maxLength={100}
                  disabled={!isOwner || saving}
                  required
                />

                <label htmlFor="sharedDestination">
                  Destination
                </label>

                <input
                  id="sharedDestination"
                  type="text"
                  name="destination"
                  value={tripSettings.destination}
                  onChange={handleTripChange}
                  placeholder="e.g. Tokyo, Japan"
                  disabled={!isOwner || saving}
                  required
                />

                <div className="date-row">
                  <label htmlFor="sharedStartDate">
                    Start Date

                    <input
                      id="sharedStartDate"
                      type="date"
                      name="startDate"
                      value={tripSettings.startDate}
                      onChange={handleTripChange}
                      max={tripSettings.endDate || undefined}
                      disabled={!isOwner || saving}
                      required
                    />
                  </label>

                  <label htmlFor="sharedEndDate">
                    End Date

                    <input
                      id="sharedEndDate"
                      type="date"
                      name="endDate"
                      value={tripSettings.endDate}
                      onChange={handleTripChange}
                      min={tripSettings.startDate || undefined}
                      disabled={!isOwner || saving}
                      required
                    />
                  </label>
                </div>

                <label htmlFor="sharedBudget">
                  Budget (RM)
                </label>

                <input
                  id="sharedBudget"
                  type="number"
                  name="budget"
                  value={tripSettings.budget}
                  onChange={handleTripChange}
                  min="0"
                  step="0.01"
                  disabled={!isOwner || saving}
                  required
                />

                <div className="trip-preview">
                  <p className="preview-label">
                    SHARED TRIP PREVIEW
                  </p>

                  <h3>
                    ✈️ {tripSettings.name || "My Trip"}
                  </h3>

                  <p>
                    📍 {tripSettings.destination || "Destination not set"}
                  </p>

                  <p>
                    📅 {formatDate(tripSettings.startDate)} –{" "}
                    {formatDate(tripSettings.endDate)}
                  </p>

                  <p>
                    💰 RM{" "}
                    {Number(tripSettings.budget || 0).toLocaleString(
                      "en-MY",
                      { maximumFractionDigits: 2 }
                    )}
                  </p>
                </div>

                {isOwner && (
                  <div className="group-form-actions">
                    <button
                      type="submit"
                      className="save-group-button"
                      disabled={saving}
                    >
                      {saving ? "Saving..." : "Save Trip Settings"}
                    </button>
                  </div>
                )}
              </form>
            </section>

            {/* Group members */}
            <section className="group-form">
              <h2>Group Members</h2>

              {(selectedGroup.memberIds || []).map(
                (memberId) => (
                  <article
                    key={memberId}
                    className="group-card"
                  >
                    <div className="group-card-icon">👤</div>

                    <div className="group-card-info">
                      <h2>
                        {selectedGroup.memberNames?.[memberId] ||
                          `Member ${memberId.slice(-6)}`}
                        {memberId === user?.uid ? " (You)" : ""}
                      </h2>

                      <p>
                        {memberId === selectedGroup.ownerId
                          ? "Owner"
                          : "Member"}
                      </p>
                    </div>
                  </article>
                )
              )}
            </section>

            {/* Invite code */}
            {isOwner && (
              <section className="group-form">
                <h2>Invite Friends</h2>

                <p>
                  Share this code with people you want to invite.
                </p>

                <h2>{selectedGroup.inviteCode}</h2>

                <button
                  type="button"
                  className="copy-invite-button"
                  onClick={() =>
                    handleCopyCode(selectedGroup.inviteCode)
                  }
                >
                  Copy Invite Code
                </button>
              </section>
            )}
          </main>
        </>
      ) : (
        <>
          <header className="groups-header">
            <div>
              <p>TRAVEL TOGETHER</p>
              <h1>👥 My Groups</h1>
              <span>Plan your next trip together.</span>
            </div>

            <div className="group-header-actions">
              <button
                type="button"
                className="create-group-button"
                onClick={() => {
                  setShowForm((previous) => !previous);
                  setShowJoinForm(false);
                  setError("");
                  setMessage("");
                }}
              >
                + Create Group
              </button>

              <button
                type="button"
                className="create-group-button"
                onClick={() => {
                  setShowJoinForm((previous) => !previous);
                  setShowForm(false);
                  setError("");
                  setMessage("");
                }}
              >
                Join Group
              </button>
            </div>
          </header>

          <main className="groups-content">
            {showForm && (
              <form
                className="group-form"
                onSubmit={handleCreateGroup}
              >
                <h2>Create a Group</h2>

                <label htmlFor="groupName">
                  Group Name
                </label>

                <input
                  id="groupName"
                  type="text"
                  value={groupName}
                  onChange={(event) =>
                    setGroupName(event.target.value)
                  }
                  placeholder="e.g. Japan Holiday"
                  maxLength={60}
                  required
                />

                <div className="group-form-actions">
                  <button
                    type="button"
                    className="cancel-group-button"
                    onClick={() => setShowForm(false)}
                  >
                    Cancel
                  </button>

                  <button
                    type="submit"
                    className="save-group-button"
                    disabled={saving}
                  >
                    {saving ? "Creating..." : "Create Group"}
                  </button>
                </div>
              </form>
            )}

            {showJoinForm && (
              <form
                className="group-form"
                onSubmit={handleJoinGroup}
              >
                <h2>Join a Group</h2>

                <label htmlFor="joinCode">
                  Invite Code
                </label>

                <input
                  id="joinCode"
                  type="text"
                  value={joinCode}
                  onChange={(event) =>
                    setJoinCode(event.target.value.toUpperCase())
                  }
                  placeholder="Enter your invite code"
                  maxLength={10}
                  required
                />

                <div className="group-form-actions">
                  <button
                    type="button"
                    className="cancel-group-button"
                    onClick={() => setShowJoinForm(false)}
                  >
                    Cancel
                  </button>

                  <button
                    type="submit"
                    className="save-group-button"
                    disabled={saving}
                  >
                    {saving ? "Joining..." : "Join Group"}
                  </button>
                </div>
              </form>
            )}

            {error && (
              <p className="groups-error">{error}</p>
            )}

            {message && (
              <p className="groups-message">{message}</p>
            )}

            {loading ? (
              <p className="groups-message">
                Loading groups...
              </p>
            ) : groups.length === 0 ? (
              <div className="groups-empty">
                <span>✈️</span>
                <h2>No groups yet</h2>
                <p>
                  Create a group or join one using an invite code.
                </p>
              </div>
            ) : (
              <div className="groups-list">
                {groups.map((group) => (
                  <article
                    className="group-card"
                    key={group.id}
                    onClick={() => openGroup(group)}
                    style={{ cursor: "pointer" }}
                  >
                    <div className="group-card-icon">🌍</div>

                    <div className="group-card-info">
                      <h2>{group.tripSettings?.name || group.name}</h2>

                      <p>
                        {group.ownerId === user?.uid
                          ? "Owner"
                          : "Member"}
                        {" · "}
                        {(group.memberIds || []).length}{" "}
                        {(group.memberIds || []).length === 1
                          ? "member"
                          : "members"}
                      </p>

                      {group.tripSettings?.destination && (
                        <p>
                          📍 {group.tripSettings.destination}
                        </p>
                      )}

                      {group.ownerId === user?.uid && (
                        <button
                          type="button"
                          className="copy-invite-button"
                          onClick={(event) => {
                            event.stopPropagation();
                            handleCopyCode(group.inviteCode);
                          }}
                        >
                          Copy Invite Code
                        </button>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </main>
        </>
      )}
    </div>
  );
}

export default Groups;