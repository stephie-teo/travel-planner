import SplitBill from "./SplitBill";

import { useEffect, useState } from "react";
import { auth, db } from "./firebase";
import {
  addDoc,
  arrayUnion,
  arrayRemove,
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
  runTransaction,
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
  const [groupSearch, setGroupSearch] = useState("");
  const [groupFilter, setGroupFilter] = useState("all");
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
  const [leaving, setLeaving] = useState(false);
  const [removingMemberId, setRemovingMemberId] = useState(null);
  const [transferringMemberId, setTransferringMemberId] = useState(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [overview, setOverview] = useState({ checklist: [], bills: [], activities: [] });
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [overviewError, setOverviewError] = useState("");
  const user = auth.currentUser;
  const ownedCount = groups.filter((group) => group.ownerId === user?.uid).length;
  const visibleGroups = groups.filter((group) => {
    if (groupFilter === "owned" && group.ownerId !== user?.uid) return false;
    if (groupFilter === "joined" && group.ownerId === user?.uid) return false;
    const search = groupSearch.trim().toLowerCase();
    return !search || [group.name, group.tripSettings?.name, group.tripSettings?.destination]
      .some((value) => String(value || "").toLowerCase().includes(search));
  });
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
  // Read-only overview. Do not mix personal budget/private records with group totals.
  const loadOverview = async (groupId) => {
    if (!groupId) return;
    setOverviewLoading(true);
    setOverviewError("");
    try {
      const paths = ["checklist", "splitBills", "activities"];
      const snapshots = await Promise.all(paths.map(name => getDocs(collection(db, "groups", groupId, name))));
      setOverview({
        checklist: snapshots[0].docs.map(d => ({ id: d.id, ...d.data() })),
        bills: snapshots[1].docs.map(d => ({ id: d.id, ...d.data() })),
        activities: snapshots[2].docs.map(d => ({ id: d.id, ...d.data() })),
      });
    } catch (err) {
      console.error("Group overview:", err);
      setOverviewError(`Unable to load group overview (${err.code || "error"}).`);
    } finally {
      setOverviewLoading(false);
    }
  };

  useEffect(() => {
    if (!selectedGroup?.id) {
      setOverview({ checklist: [], bills: [], activities: [] });
      setOverviewError("");
      return;
    }
    loadOverview(selectedGroup.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedGroup?.id]);

  const membersForOverview = selectedGroup?.memberIds || [];
  const sharedDone = overview.checklist.filter(item =>
    item.completionMode === "everyone"
      ? membersForOverview.length > 0 && membersForOverview.every(id => item.completedBy?.[id] === true)
      : item.completed === true
  ).length;
  const groupBillTotal = overview.bills.reduce((sum, bill) =>
    sum + (Number.isSafeInteger(bill.amountCents) && bill.amountCents > 0 ? bill.amountCents : 0), 0
  );
  const localToday = new Date();
  const todayString = `${localToday.getFullYear()}-${String(localToday.getMonth() + 1).padStart(2, "0")}-${String(localToday.getDate()).padStart(2, "0")}`;
  const upcomingActivities = overview.activities
    .filter(item => item.date && item.date >= todayString)
    .sort((a, b) => `${a.date} ${a.time || ""}`.localeCompare(`${b.date} ${b.time || ""}`))
    .slice(0, 3);
  const money = cents => (cents / 100).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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
  // Step 2.1B-1: a non-owner can remove only their own membership.
  // Shared itinerary, expenses and other group documents are preserved.
  const handleLeaveGroup = async () => {
    const currentUser = auth.currentUser;
    if (!selectedGroup || !currentUser) {
      setError("Please sign in and select a group.");
      return;
    }
    if (selectedGroup.ownerId === currentUser.uid) {
      setError("Group owners cannot leave. Transfer ownership first (coming later).");
      return;
    }
    if (!selectedGroup.memberIds?.includes(currentUser.uid)) {
      setError("You are no longer a member of this group.");
      await loadGroups();
      return;
    }
    const confirmed = window.confirm(
      `Leave "${selectedGroup.name}"?\n\n` +
      "You will lose access to the group's shared trip data. " +
      "Your previous contributions will stay in the group. " +
      "You can join again later using a valid invite code."
    );
    if (!confirmed) return;
    setLeaving(true);
    setError("");
    setMessage("");
    const leavingName = selectedGroup.name;
    const leavingId = selectedGroup.id;
    try {
      await updateDoc(doc(db, "groups", leavingId), {
        memberIds: arrayRemove(currentUser.uid),
      });
      setSelectedGroup(null);
      setTripSettings(getDefaultTrip());
      setGroups((previous) => previous.filter((group) => group.id !== leavingId));
      setMessage(`You left "${leavingName}". You can rejoin using its invite code.`);
    } catch (err) {
      console.error("Failed to leave group:", err);
      setError(
        err.code === "permission-denied"
          ? "Permission denied. Publish the Step 2.1B-1 Firestore Rules before trying again."
          : `Unable to leave group (${err.code || "unknown error"}). Please try again.`
      );
    } finally {
      setLeaving(false);
    }
  };

  // Step 2.1B-2: owner removes one non-owner member without banning them.
  const handleRemoveMember = async (memberId) => {
    const currentUser = auth.currentUser;
    if (!selectedGroup || !currentUser || selectedGroup.ownerId !== currentUser.uid) {
      setError("Only the group owner can remove members.");
      return;
    }
    if (memberId === selectedGroup.ownerId || !selectedGroup.memberIds?.includes(memberId)) {
      setError("This member cannot be removed.");
      return;
    }
    const memberName = selectedGroup.memberNames?.[memberId] || `Member ${memberId.slice(-6)}`;
    if (!window.confirm(
      `Remove ${memberName} from "${selectedGroup.name}"?\n\n` +
      "They will lose access to this group, but their shared contributions will remain. " +
      "They can rejoin later with a valid invite code."
    )) return;

    setRemovingMemberId(memberId);
    setError("");
    setMessage("");
    try {
      await updateDoc(doc(db, "groups", selectedGroup.id), {
        memberIds: arrayRemove(memberId),
      });
      const groupId = selectedGroup.id;
      setGroups((previous) => previous.map((group) =>
        group.id === groupId
          ? { ...group, memberIds: (group.memberIds || []).filter((id) => id !== memberId) }
          : group
      ));
      setSelectedGroup((previous) => previous?.id === groupId
        ? { ...previous, memberIds: (previous.memberIds || []).filter((id) => id !== memberId) }
        : previous
      );
      setMessage(`${memberName} was removed. They may rejoin with a valid invite code.`);
    } catch (err) {
      console.error("Failed to remove member:", err);
      setError(err.code === "permission-denied"
        ? "Permission denied. Check that the Step 2.1B-2 Firestore Rules are published."
        : `Unable to remove member (${err.code || "unknown error"}). Please try again.`);
    } finally {
      setRemovingMemberId(null);
    }
  };

  // Delete a group and its shared data.
// Only the group owner can perform this action.
// Step 2.1C: transfer ownership to an existing group member.
  const handleTransferOwnership = async (memberId) => {
    const currentUser = auth.currentUser;
    if (!selectedGroup || !currentUser || selectedGroup.ownerId !== currentUser.uid) {
      setError("Only the current group owner can transfer ownership.");
      return;
    }
    if (memberId === currentUser.uid || !selectedGroup.memberIds?.includes(memberId)) {
      setError("Select another existing member to become the owner.");
      return;
    }
    const memberName = selectedGroup.memberNames?.[memberId] || `Member ${memberId.slice(-6)}`;
    const confirmed = window.confirm(
      `Transfer ownership of "${selectedGroup.name}" to ${memberName}?\n\n` +
      "You will become a regular member. The new owner will be able to manage members, " +
      "edit trip settings, and delete this group.\n\nThis cannot be undone by you."
    );
    if (!confirmed) return;
    setTransferringMemberId(memberId);
    setError("");
    setMessage("");
    try {
      const groupRef = doc(db, "groups", selectedGroup.id);
      await runTransaction(db, async (transaction) => {
        const snapshot = await transaction.get(groupRef);
        if (!snapshot.exists()) throw new Error("This group no longer exists.");
        const data = snapshot.data();
        if (data.ownerId !== currentUser.uid) throw new Error("You are no longer the owner.");
        if (!Array.isArray(data.memberIds) || !data.memberIds.includes(memberId)) {
          throw new Error("This member is no longer in the group.");
        }
        transaction.update(groupRef, { ownerId: memberId });
      });
      setGroups((previous) => previous.map((group) =>
        group.id === selectedGroup.id ? { ...group, ownerId: memberId } : group
      ));
      setSelectedGroup((previous) =>
        previous?.id === selectedGroup.id ? { ...previous, ownerId: memberId } : previous
      );
      setMessage(`Ownership transferred to ${memberName}. You are now a member.`);
    } catch (err) {
      console.error("Failed to transfer ownership:", err);
      setError(err.code === "permission-denied"
        ? "Permission denied. Check that the Step 2.1C Firestore Rules are published."
        : `Unable to transfer ownership: ${err.message || "Unknown error"}`);
    } finally {
      setTransferringMemberId(null);
    }
  };

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
      "splitBills",
      "settlements",
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
            disabled={deleting || leaving}
            onClick={() => {
              setSelectedGroup(null);
              setMessage("");
              setError("");
            }}
          >
            ← Back to Groups
          </button>
          {!isOwner && (
            <button
              type="button"
              className="leave-group-button"
              onClick={handleLeaveGroup}
              disabled={leaving || deleting || saving}
            >
              {leaving ? "Leaving..." : "Leave Group"}
            </button>
          )}
          {isOwner && (
            <button
              type="button"
              className="delete-group-button"
              onClick={handleDeleteGroup}
              disabled={deleting || saving || transferringMemberId !== null || removingMemberId !== null}
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
            {/* Step 2.8: compact group-only summary, independent of personal budget. */}
            <section className="group-overview-panel" aria-label="Group trip overview">
              <div className="group-overview-heading">
                <div>
                  <p className="group-overview-eyebrow">GROUP TRIP OVERVIEW</p>
                  <h1>{selectedGroup.tripSettings?.name || selectedGroup.name}</h1>
                  <p className="group-overview-subtitle">
                    {selectedGroup.tripSettings?.destination || "Destination not set"}
                    {selectedGroup.tripSettings?.startDate ? ` · ${formatDate(selectedGroup.tripSettings.startDate)}` : ""}
                    {selectedGroup.tripSettings?.endDate ? ` – ${formatDate(selectedGroup.tripSettings.endDate)}` : ""}
                  </p>
                </div>
                <button type="button" className="group-overview-refresh" onClick={() => loadOverview(selectedGroup.id)} disabled={overviewLoading}>
                  {overviewLoading ? "Refreshing..." : "↻ Refresh"}
                </button>
              </div>
              {overviewError && <p className="groups-error" role="alert">{overviewError}</p>}
              <div className="group-overview-stats">
                <div className="group-overview-stat">
                  <span>👥 Group Members</span>
                  <strong>{membersForOverview.length}</strong>
                  <small>{isOwner ? "You are the owner" : "You are a member"}</small>
                </div>
                <div className="group-overview-stat">
                  <span>☑️ Shared Checklist</span>
                  <strong>{overviewLoading ? "…" : `${sharedDone} / ${overview.checklist.length}`}</strong>
                  <small>Fully completed group tasks</small>
                </div>
                <div className="group-overview-stat">
                  <span>💳 Split Bills Total</span>
                  <strong>{overviewLoading ? "…" : `RM ${money(groupBillTotal)}`}</strong>
                  <small>Recorded group bills · not your personal share</small>
                </div>
              </div>
              <div className="group-overview-upcoming">
                <h2>📅 Upcoming Activities</h2>
                {overviewLoading ? <p className="group-overview-empty">Loading activities...</p> :
                  upcomingActivities.length ? (
                    <div className="group-overview-activity-list">
                      {upcomingActivities.map(activity => (
                        <div className="group-overview-activity" key={activity.id}>
                          <div><strong>{activity.title || "Untitled activity"}</strong>
                            <span>{formatDate(activity.date)}{activity.time ? ` · ${activity.time}` : ""}</span>
                          </div>
                          {activity.location && <small>📍 {activity.location}</small>}
                        </div>
                      ))}
                    </div>
                  ) : <p className="group-overview-empty">No upcoming group activities yet.</p>}
              </div>
              <p className="group-overview-note">Shared Checklist counts an Everyone Must Complete task only when all current members finish it. Split Bills Total excludes private purchases and is not a personal balance.</p>
            </section>
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
                  Budget per person (RM)
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
                    GROUP TRIP PREVIEW
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
                    💰 Per person: RM{" "}
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
              <div className="group-member-overview" aria-label="Group member summary">
                <span>👥 {(selectedGroup.memberIds || []).length} members</span>
                <span>{isOwner ? "⭐ You are the owner" : "🤝 You are a member"}</span>
              </div>
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
                    {isOwner && memberId !== selectedGroup.ownerId && (
                      <button
                        type="button"
                        className="group-transfer-owner-button"
                        onClick={() => handleTransferOwnership(memberId)}
                        disabled={transferringMemberId !== null || removingMemberId !== null || deleting || saving || leaving}
                        aria-label={`Transfer group ownership to ${selectedGroup.memberNames?.[memberId] || "member"}`}
                      >
                        {transferringMemberId === memberId ? "Transferring..." : "Make Owner"}
                      </button>
                    )}
                    {isOwner && memberId !== selectedGroup.ownerId && (
                      <button
                        type="button"
                        className="group-remove-member-button"
                        onClick={() => handleRemoveMember(memberId)}
                        disabled={removingMemberId !== null || transferringMemberId !== null || deleting || saving || leaving}
                        aria-label={`Remove ${selectedGroup.memberNames?.[memberId] || "member"} from group`}
                      >
                        {removingMemberId === memberId ? "Removing..." : "Remove"}
                      </button>
                    )}
                  </article>
                )
              )}
            </section>
              {/* Step 2.3A: Group-only shared expense records */}
              <SplitBill group={selectedGroup} view="settlements" />
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
              {!loading && groups.length > 0 && (
                <section className="group-list-toolbar" aria-label="Filter groups">
                  <div className="group-summary-row">
                    <div><strong>{groups.length}</strong><span>All groups</span></div>
                    <div><strong>{ownedCount}</strong><span>Owned by you</span></div>
                    <div><strong>{groups.length - ownedCount}</strong><span>Joined groups</span></div>
                  </div>
                  <div className="group-toolbar-controls">
                    <label className="group-search-label">
                      <span>Search groups</span>
                      <input type="search" value={groupSearch}
                        onChange={(event) => setGroupSearch(event.target.value)}
                        placeholder="Search by group or destination..." />
                    </label>
                    <label className="group-filter-label">
                      <span>Show</span>
                      <select value={groupFilter} onChange={(event) => setGroupFilter(event.target.value)}>
                        <option value="all">All groups</option>
                        <option value="owned">Owned by me</option>
                        <option value="joined">Joined groups</option>
                      </select>
                    </label>
                  </div>
                </section>
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
              ) : visibleGroups.length === 0 ? (
                <div className="groups-empty" role="status">
                  <span>🔎</span><h2>No matching groups</h2>
                  <p>Try another search or choose a different filter.</p>
                  <button type="button" className="cancel-group-button"
                    onClick={() => { setGroupSearch(""); setGroupFilter("all"); }}>
                    Clear filters
                  </button>
                </div>
              ) : (
                <div className="groups-list">
                  {visibleGroups.map((group) => (
                  <article
                    className="group-card"
                    key={group.id}
                      onClick={() => openGroup(group)}
                      onKeyDown={(event) => {
                        if (event.target !== event.currentTarget) return;
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          openGroup(group);
                        }
                      }}
                      role="button"
                      tabIndex={0}
                      aria-label={`Open ${group.tripSettings?.name || group.name} group`}
                      style={{ cursor: "pointer" }}
                  >
                    <div className="group-card-icon">🌍</div>
                    <div className="group-card-info">
                        <div className="group-card-title-row">
                          <h2>{group.tripSettings?.name || group.name}</h2>
                          <span className={`group-role-pill ${group.ownerId === user?.uid ? "owner" : "member"}`}>
                            {group.ownerId === user?.uid ? "Owner" : "Member"}
                          </span>
                        </div>
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