
import "./App.css";

import Itinerary from "./Itinerary";
import Expenses from "./Expenses";
import Places from "./Places";
import Checklist from "./Checklist";
import TravelInfo from "./TravelInfo";
import TripSettings from "./TripSettings";
import Groups from "./Groups";
import MyTrips from "./MyTrips";
import Login from "./Login";
import Register from "./Register";
import { auth, db } from "./firebase";
import {
  onAuthStateChanged,
  signOut,
  updateProfile,
} from "firebase/auth";
import {
  doc,
  getDoc,
  collection,
  getDocs,
  query,
  where,
  onSnapshot,
  setDoc,
} from "firebase/firestore";
import { useEffect, useState } from "react";
// Store each user's last selected personal trip in this browser.
const selectedTripStorageKey = (uid) => `travel-planner:selected-trip:${uid}`;
const readSavedTripId = (uid) => {
  try {
    return window.localStorage.getItem(selectedTripStorageKey(uid)) || null;
  } catch (error) {
    console.warn("Could not read saved trip selection:", error);
    return null;
  }
};
const saveSelectedTripId = (uid, tripId) => {
  try {
    if (tripId) {
      window.localStorage.setItem(selectedTripStorageKey(uid), tripId);
    } else {
      window.localStorage.removeItem(selectedTripStorageKey(uid));
    }
  } catch (error) {
    console.warn("Could not save trip selection:", error);
  }
};
const EMPTY_TRIP = {
  name: "",
  destination: "",
  startDate: "",
  endDate: "",
  budget: 0,
};
function App() {
  const [user, setUser] = useState(undefined);
  const [authPage, setAuthPage] = useState("login");
  const [trip, setTrip] = useState(null);
  const [selectedTripId, setSelectedTripId] = useState(null);
  const [personalRefresh, setPersonalRefresh] = useState(0);
  const [hasTrip, setHasTrip] = useState(false);
  const [tripLoaded, setTripLoaded] = useState(false);
  const [personalError, setPersonalError] = useState("");
  const [activities, setActivities] = useState([]);
  const [totalSpent, setTotalSpent] = useState(0);
  const [totalPlanned, setTotalPlanned] = useState(0);
  const [checklist, setChecklist] = useState([]);
  // Group Dashboard state
  const [dashboardMode, setDashboardMode] = useState("personal");
  const [userGroups, setUserGroups] = useState([]);
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [groupDashboardData, setGroupDashboardData] = useState(null);
  const [myGroupBudget, setMyGroupBudget] = useState(0);
  const [budgetInput, setBudgetInput] = useState("0");
  const [budgetSaving, setBudgetSaving] = useState(false);
  const [budgetEditing, setBudgetEditing] = useState(false);
  const [budgetNotice, setBudgetNotice] = useState("");
  const [groupLoading, setGroupLoading] = useState(false);
  const [groupError, setGroupError] = useState("");
  const [groupsLoaded, setGroupsLoaded] = useState(false);
  const [page, setPage] = useState("home");
  const [showAccountMenu, setShowAccountMenu] = useState(false);
  const [profileName, setProfileName] = useState("");
  const [profileDraft, setProfileDraft] = useState("");
  const [profileEditing, setProfileEditing] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [profileNotice, setProfileNotice] = useState("");
  // ==================== Firebase Auth ====================
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setTrip(null);
      setSelectedTripId(currentUser ? readSavedTripId(currentUser.uid) : null);
      setHasTrip(false);
      setTripLoaded(false);
      setPersonalError("");
      setActivities([]);
      setTotalSpent(0);
      setTotalPlanned(0);
      setChecklist([]);
      setDashboardMode("personal");
      setUserGroups([]);
      setSelectedGroupId("");
      setGroupDashboardData(null);
      setMyGroupBudget(0);
      setGroupLoading(false);
      setGroupError("");
      setGroupsLoaded(false);
      setUser(currentUser);
      setPage("home");
      setShowAccountMenu(false);
      setProfileName(currentUser?.displayName?.trim() || "");
      setProfileEditing(false);
      setProfileError("");
      setProfileNotice("");
    });
    return () => unsubscribe();
  }, []);
  // Keep the displayed name aligned with the shared group profile.
  useEffect(() => {
    if (!user?.uid) return;
    let cancelled = false;
    getDoc(doc(db, "userProfiles", user.uid))
      .then((snapshot) => {
        const savedName = snapshot.data()?.displayName;
        if (!cancelled && typeof savedName === "string" && savedName.trim()) {
          setProfileName(savedName.trim());
        }
      })
      .catch((error) => console.warn("Could not load profile name:", error));
    return () => { cancelled = true; };
  }, [user?.uid]);

  const openProfileEditor = () => {
    setProfileDraft(profileName || user?.displayName || user?.email?.split("@")[0] || "");
    setProfileError("");
    setProfileNotice("");
    setShowAccountMenu(false);
    setProfileEditing(true);
  };

  const saveProfileName = async (event) => {
    event.preventDefault();
    const name = profileDraft.trim();
    if (name.length < 2 || name.length > 40) {
      setProfileError("Username must be between 2 and 40 characters.");
      return;
    }
    const currentUser = auth.currentUser;
    if (!currentUser) {
      setProfileError("Please sign in again to update your profile.");
      return;
    }
    setProfileSaving(true);
    setProfileError("");
    try {
      // Save the shared profile first so group members see the same name.
      await setDoc(doc(db, "userProfiles", currentUser.uid), {
        displayName: name,
        email: currentUser.email || "",
      }, { merge: true });
      setProfileName(name);
      try {
        await updateProfile(currentUser, { displayName: name });
        setUser({ ...currentUser, displayName: name });
        setProfileEditing(false);
        setProfileNotice("Username updated successfully!");
      } catch (authError) {
        console.error("Firebase Auth profile update failed:", authError);
        setProfileError("Saved to group profile, but account display name could not sync. Please retry.");
      }
    } catch (error) {
      console.error("Profile save failed:", error);
      setProfileError(error.code === "permission-denied"
        ? "Permission denied. Check userProfiles Firestore Rules."
        : "Unable to save your username. Please try again.");
    } finally {
      setProfileSaving(false);
    }
  };

  // ==================== Personal Dashboard (V2 Smart Fallback) ====================
  useEffect(() => {
    if (!user) return;

    let cancelled = false;
    setTripLoaded(false);
    setTrip(null);
    setHasTrip(false);
    setPersonalError("");
    setActivities([]);
    setTotalSpent(0);
    setTotalPlanned(0);
    setChecklist([]);

    async function loadPersonalDashboard() {
      try {
        let activeTripId = selectedTripId;
        let tripSnap = null;

        if (activeTripId) {
          tripSnap = await getDoc(doc(db, "users", user.uid, "trips", activeTripId));
          if (cancelled) return;
          if (!tripSnap.exists() || tripSnap.data()?.archived === true) {
            activeTripId = null;
            tripSnap = null;
          }
        }

        // No valid selection: choose another active V2 trip, never the legacy path.
        if (!activeTripId) {
          const allTripsSnap = await getDocs(collection(db, "users", user.uid, "trips"));
          if (cancelled) return;

          const availableTrips = allTripsSnap.docs
            .filter((item) => item.data()?.archived !== true)
            .sort((a, b) => {
              const aTime = a.data().updatedAt?.toMillis?.() ?? a.data().createdAt?.toMillis?.() ?? 0;
              const bTime = b.data().updatedAt?.toMillis?.() ?? b.data().createdAt?.toMillis?.() ?? 0;
              return bTime - aTime || a.id.localeCompare(b.id);
            });

          const fallbackTrip = availableTrips[0];
          if (fallbackTrip) {
            activeTripId = fallbackTrip.id;
            tripSnap = fallbackTrip;
          } else {
            // No active V2 trips. Show the create-trip entry on the dashboard.
            saveSelectedTripId(user.uid, null);
            setSelectedTripId(null);
            setTrip({ ...EMPTY_TRIP });
            setHasTrip(false);
            return;
          }
        }

        // Persist the replacement, and re-run this effect with the new selection.
        if (activeTripId !== selectedTripId) {
          saveSelectedTripId(user.uid, activeTripId);
          setSelectedTripId(activeTripId);
          return;
        }

        const base = ["users", user.uid, "trips", activeTripId];
        const [expenseSnap, activitySnap, checklistSnap] = await Promise.all([
          getDocs(collection(db, ...base, "expenses")),
          getDocs(collection(db, ...base, "activities")),
          getDocs(collection(db, ...base, "checklist")),
        ]);
        if (cancelled) return;

        setTrip(tripSnap.data());
        setHasTrip(true);
        let planned = 0;
        let spent = 0;
        expenseSnap.forEach((item) => {
          planned += Number(item.data().plannedAmount) || 0;
          spent += Number(item.data().actualAmount) || 0;
        });
        setTotalPlanned(planned);
        setTotalSpent(spent);
        setActivities(activitySnap.docs.map((item) => ({ id: item.id, ...item.data() })));
        setChecklist(checklistSnap.docs.map((item) => ({ id: item.id, ...item.data() })));
      } catch (error) {
        console.error("Failed to load personal dashboard:", error);
        if (!cancelled) {
          setPersonalError("Unable to load your trips. Please check your connection and try again.");
          setTrip({ ...EMPTY_TRIP });
          setHasTrip(false);
        }
      } finally {
        if (!cancelled) setTripLoaded(true);
      }
    }

    loadPersonalDashboard();
    return () => { cancelled = true; };
  }, [user?.uid, selectedTripId, personalRefresh]);

  // ==================== Load Groups For Dashboard ====================
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const loadUserGroups = async () => {
      setGroupsLoaded(false);
      setGroupError("");
      try {
        const groupsQuery = query(
          collection(db, "groups"),
          where("memberIds", "array-contains", user.uid)
        );
        const snapshot = await getDocs(groupsQuery);
        const loadedGroups = snapshot.docs.map((item) => ({
          id: item.id,
          ...item.data(),
        }));
        if (cancelled) return;
        setUserGroups(loadedGroups);
        setSelectedGroupId((previous) => {
          if (
            previous &&
            loadedGroups.some((group) => group.id === previous)
          ) {
            return previous;
          }
          return loadedGroups[0]?.id || "";
        });
      } catch (error) {
        console.error("Failed to load dashboard groups:", error);
        if (!cancelled) {
          setUserGroups([]);
          setSelectedGroupId("");
          setGroupError(
            "Unable to load your groups. Please check your connection or Firestore Rules."
          );
        }
      } finally {
        if (!cancelled) {
          setGroupsLoaded(true);
        }
      }
    };
    loadUserGroups();
    return () => {
      cancelled = true;
    };
  }, [user]);
// ==================== Real-time Group Dashboard ====================
useEffect(() => {
  if (!user || dashboardMode !== "group" || !selectedGroupId) {
    setGroupDashboardData(null);
    setGroupLoading(false);
    setGroupError("");
    return;
  }
  let cancelled = false;
  let listenerFailed = false;
  let groupData = null;
  let groupReady = false;
  let groupActivities = [];
  let activitiesReady = false;
  let groupExpenses = [];
  let expensesReady = false;
  let groupChecklist = [];
  let checklistReady = false;
  let splitBills = [], assigned = [], privateExpenses = [], privateChecklist = [];
  let splitReady = false, assignedReady = false, privateReady = false, privateChecklistReady = false;
  setGroupLoading(true);
  setGroupError("");
  setGroupDashboardData(null);
  const handleListenerError = (error) => {
    if (cancelled) return;
    console.error("Group Dashboard real-time listener error:", error);
    listenerFailed = true;
    setGroupLoading(false);
    setGroupDashboardData(null);
    if (error.code === "permission-denied") {
      setGroupError(
        "You don't have permission to view this group's data. Please check your Firestore Rules."
      );
    } else {
      setGroupError(
        "Unable to load the latest group data. Please check your connection and try again."
      );
    }
  };
  const syncDashboard = () => {
    if (
      cancelled ||
      listenerFailed ||
      !groupReady ||
      !activitiesReady ||
      !expensesReady ||
      !checklistReady ||
      !splitReady || !assignedReady || !privateReady || !privateChecklistReady ||
      !groupData
    ) {
      return;
    }
    const tripSettings = groupData.tripSettings || {};
    let planned = 0;
    let spent = 0;
    groupExpenses.forEach((expense) => {
      planned += Number(expense.plannedAmount) || 0;
      spent += Number(expense.actualAmount) || 0;
    });
    const splitTotalCents = splitBills.reduce((sum, bill) => sum + (Number.isSafeInteger(bill.amountCents) && bill.amountCents > 0 ? bill.amountCents : 0), 0);
    const ownSplitCents = splitBills.reduce((sum, bill) => {
      const share = Array.isArray(bill.shares) ? bill.shares.find(s => s.uid === user.uid) : null;
      return sum + (Number.isSafeInteger(share?.amountCents) && share.amountCents >= 0 ? share.amountCents : 0);
    }, 0);
    const standaloneAssigned = assigned.filter(x => !x.linkedBillId);
    const assignedActualCents = standaloneAssigned.reduce((sum, x) => sum + (x.allocations || []).reduce((n, a) => n + (Number(a.actualCents) || 0), 0), 0);
    const ownAssignedActualCents = standaloneAssigned.reduce((sum, x) => sum + (Number(x.allocations?.find(a => a.uid === user.uid)?.actualCents) || 0), 0);
    const ownAssignedPlannedCents = assigned.reduce((sum, x) => sum + (Number(x.allocations?.find(a => a.uid === user.uid)?.plannedCents) || 0), 0);
    const ownPrivateActual = privateExpenses.reduce((sum, x) => sum + (Number(x.actualAmount) || 0), 0);
    const ownPrivatePlanned = privateExpenses.reduce((sum, x) => sum + (Number(x.plannedAmount) || 0), 0);
    setGroupDashboardData({
      group: groupData,
      groupSharedSpent: spent + splitTotalCents / 100 + assignedActualCents / 100,
      groupSharedPlanned: planned + assigned.reduce((sum, x) => sum + (x.allocations || []).reduce((n, a) => n + (Number(a.plannedCents) || 0), 0), 0) / 100,
      myActualSpent: ownPrivateActual + (ownAssignedActualCents + ownSplitCents) / 100,
      myPlanned: ownPrivatePlanned + ownAssignedPlannedCents / 100,
      privateSpent: ownPrivateActual,
      splitShare: ownSplitCents / 100,
      trip: {
        ...EMPTY_TRIP,
        name: tripSettings.name || groupData.name || "",
        destination: tripSettings.destination || "",
        startDate: tripSettings.startDate || "",
        endDate: tripSettings.endDate || "",
        budget: Number(tripSettings.budget) || 0,
      },
      activities: groupActivities,
      checklist: groupChecklist,
      privateChecklist,
      totalPlanned: planned,
      totalSpent: spent,
    });
    setGroupError("");
    setGroupLoading(false);
  };
  const groupRef = doc(db, "groups", selectedGroupId);
  // 1. Listen for group details and shared trip settings.
  const unsubscribeGroup = onSnapshot(
    groupRef,
    (snapshot) => {
      if (cancelled || listenerFailed) return;
      if (!snapshot.exists()) {
        listenerFailed = true;
        setGroupDashboardData(null);
        setGroupLoading(false);
        setGroupError(
          "This group could not be found. It may have been deleted."
        );
        return;
      }
      const latestGroup = {
        id: snapshot.id,
        ...snapshot.data(),
      };
      if (!(latestGroup.memberIds || []).includes(user.uid)) {
        listenerFailed = true;
        setGroupDashboardData(null);
        setGroupLoading(false);
        setGroupError(
          "You are no longer a member of this group."
        );
        return;
      }
      groupData = latestGroup;
      groupReady = true;
      syncDashboard();
    },
    handleListenerError
  );
  // 2. Listen for itinerary changes.
  const unsubscribeActivities = onSnapshot(
    collection(db, "groups", selectedGroupId, "activities"),
    (snapshot) => {
      if (cancelled || listenerFailed) return;
      groupActivities = snapshot.docs.map((item) => ({
        id: item.id,
        ...item.data(),
      }));
      activitiesReady = true;
      syncDashboard();
    },
    handleListenerError
  );
  // 3. Listen for expense changes.
  const unsubscribeExpenses = onSnapshot(
    collection(db, "groups", selectedGroupId, "expenses"),
    (snapshot) => {
      if (cancelled || listenerFailed) return;
      groupExpenses = snapshot.docs.map((item) => ({
        id: item.id,
        ...item.data(),
      }));
      expensesReady = true;
      syncDashboard();
    },
    handleListenerError
  );
  // 4. Listen for checklist changes.
  const unsubscribeChecklist = onSnapshot(
    collection(db, "groups", selectedGroupId, "checklist"),
    (snapshot) => {
      if (cancelled || listenerFailed) return;
      groupChecklist = snapshot.docs.map((item) => ({
        id: item.id,
        ...item.data(),
      }));
      checklistReady = true;
      syncDashboard();
    },
    handleListenerError
  );
  // 5. Split bills, assigned costs and private purchases: same sources as Expenses.
  const unsubscribeSplit = onSnapshot(
    collection(db, "groups", selectedGroupId, "splitBills"),
    snapshot => { splitBills = snapshot.docs.map(d => d.data()); splitReady = true; syncDashboard(); },
    handleListenerError
  );
  const unsubscribeAssigned = onSnapshot(
    collection(db, "groups", selectedGroupId, "assignedExpenses"),
    snapshot => { assigned = snapshot.docs.map(d => d.data()); assignedReady = true; syncDashboard(); },
    handleListenerError
  );
  const unsubscribePrivate = onSnapshot(
    collection(db, "users", user.uid, "groupPrivateExpenses", selectedGroupId, "items"),
    snapshot => { privateExpenses = snapshot.docs.map(d => d.data()); privateReady = true; syncDashboard(); },
    handleListenerError
  );
  // Private checklist belongs to this user, even when the trip is shared.
  const unsubscribePrivateChecklist = onSnapshot(
    collection(db, "users", user.uid, "groupChecklists", selectedGroupId, "items"),
    snapshot => { privateChecklist = snapshot.docs.map(d => ({ id: d.id, ...d.data() })); privateChecklistReady = true; syncDashboard(); },
    handleListenerError
  );
  // Clean up all listeners when the user changes group,
  // switches to Personal Trip, logs out, or unmounts App.
  return () => {
    cancelled = true;
    unsubscribeGroup();
    unsubscribeActivities();
    unsubscribeExpenses();
    unsubscribeChecklist();
    unsubscribeSplit();
    unsubscribeAssigned();
    unsubscribePrivate();
    unsubscribePrivateChecklist();
  };
}, [user?.uid, dashboardMode, selectedGroupId]);
  // Per-user, per-group budget. Other group members cannot read this document.
  useEffect(() => {
    setMyGroupBudget(0);
    setBudgetInput("0");
    setBudgetNotice("");
    setBudgetEditing(false);
    if (!user?.uid || dashboardMode !== "group" || !selectedGroupId) return;
    return onSnapshot(doc(db, "users", user.uid, "groupBudgets", selectedGroupId), snapshot => {
      const value = Number(snapshot.data()?.budget) || 0;
      setMyGroupBudget(value);
      setBudgetInput(String(value));
    }, err => setBudgetNotice(`Cannot load your budget: ${err.code || err.message}`));
  }, [user?.uid, dashboardMode, selectedGroupId]);

  // ==================== Auth Loading ====================
  if (user === undefined) {
    return (
      <div className="auth-loading">
        <div className="auth-loading-icon">✈️</div>
        <p>Loading your trip planner...</p>
      </div>
    );
  }
  // ==================== Login / Register ====================
  if (!user) {
    if (authPage === "register") {
      return (
        <Register
          onRegister={() => setAuthPage("login")}
          onShowLogin={() => setAuthPage("login")}
        />
      );
    }
    return (
      <Login
        onLogin={() => {}}
        onShowRegister={() => setAuthPage("register")}
      />
    );
  }
  // ==================== Personal Trip Loading ====================
  if (!tripLoaded || trip === null) {
    return (
      <div className="auth-loading">
        <div className="auth-loading-icon">✈️</div>
        <p>Loading your trip...</p>
      </div>
    );
  }
  // ==================== Navigation Helpers ====================
  const goToPage = (nextPage) => {
    // V2-only personal pages must never silently fall back to legacy data.
    // Group pages remain accessible without a selected personal trip.
    const needsPersonalTrip = [
      "trip-settings", "itinerary", "expenses", "places", "checklist", "travel-info",
    ].includes(nextPage);
    if (!selectedTripId && needsPersonalTrip &&
        (nextPage === "trip-settings" || dashboardMode === "personal")) {
      setPage("my-trips");
      setShowAccountMenu(false);
      return;
    }
    setPage(nextPage);
    setShowAccountMenu(false);
    if (nextPage === "home") {
      setPersonalRefresh((n) => n + 1);
      // Refresh the group list when returning to the dashboard.
      setGroupsLoaded(false);
      const refreshGroups = async () => {
        try {
          const groupsQuery = query(
            collection(db, "groups"),
            where("memberIds", "array-contains", user.uid)
          );
          const snapshot = await getDocs(groupsQuery);
          const loadedGroups = snapshot.docs.map((item) => ({
            id: item.id,
            ...item.data(),
          }));
          setUserGroups(loadedGroups);
          setSelectedGroupId((previous) => {
            if (
              previous &&
              loadedGroups.some((group) => group.id === previous)
            ) {
              return previous;
            }
            return loadedGroups[0]?.id || "";
          });
          setGroupError("");
        } catch (error) {
          console.error("Failed to refresh groups:", error);
          setGroupError("Unable to refresh your groups.");
        } finally {
          setGroupsLoaded(true);
        }
      };
      refreshGroups();
    }
  };
  const handleLogout = async () => {
    try {
      await signOut(auth);
      setPage("home");
      setShowAccountMenu(false);
    } catch (error) {
      console.error("Logout failed:", error);
    }
  };
  const saveMyGroupBudget = async event => {
    event.preventDefault();
    if (!user?.uid || !selectedGroupId) return;
    const value = Number(budgetInput);
    if (!/^\d+(?:\.\d{1,2})?$/.test(budgetInput.trim()) || !Number.isFinite(value) || value > 10000000) {
      setBudgetNotice("Enter a valid budget (RM 0 to RM 10,000,000).");
      return;
    }
    setBudgetSaving(true); setBudgetNotice("");
    try {
      await setDoc(doc(db, "users", user.uid, "groupBudgets", selectedGroupId), { budget: value }, { merge: true });
      setBudgetNotice("Budget saved.");
      setBudgetEditing(false);
    } catch (err) { setBudgetNotice(`Could not save budget: ${err.code || err.message}`); }
    finally { setBudgetSaving(false); }
  };
  // ==================== Dashboard Data ====================
  const isGroupDashboard = dashboardMode === "group";
  const selectedGroup = groupDashboardData?.group || null;
  const dashboardTrip = isGroupDashboard
    ? groupDashboardData?.trip || EMPTY_TRIP
    : trip;
  const dashboardHasTrip = isGroupDashboard
    ? Boolean(
        dashboardTrip?.name ||
        dashboardTrip?.destination ||
        dashboardTrip?.startDate
      )
    : hasTrip;
  const dashboardActivities = isGroupDashboard
    ? groupDashboardData?.activities || []
    : activities;
  const dashboardChecklist = isGroupDashboard
    ? groupDashboardData?.checklist || []
    : checklist;
  const dashboardTotalSpent = isGroupDashboard
    ? groupDashboardData?.groupSharedSpent || 0
    : totalSpent;
  const dashboardTotalPlanned = isGroupDashboard
    ? groupDashboardData?.groupSharedPlanned || 0
    : totalPlanned;
  const formatDate = (dateString, options = {}) => {
    if (!dateString) return "Date not set";
    const date = new Date(`${dateString}T00:00:00`);
    if (Number.isNaN(date.getTime())) return "Date not set";
    return date.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      ...options,
    });
  };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayString = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, "0"),
    String(today.getDate()).padStart(2, "0"),
  ].join("-");
  const startDate = dashboardTrip.startDate
    ? new Date(`${dashboardTrip.startDate}T00:00:00`)
    : null;
  const endDate = dashboardTrip.endDate
    ? new Date(`${dashboardTrip.endDate}T00:00:00`)
    : null;
  const validStartDate =
    startDate && !Number.isNaN(startDate.getTime());
  const validEndDate =
    endDate && !Number.isNaN(endDate.getTime());
  const validTripDates =
    validStartDate &&
    validEndDate &&
    endDate >= startDate;
  const perPersonBudget = Number(dashboardTrip?.budget) || 0;
  const memberCount = isGroupDashboard ? (selectedGroup?.memberIds?.length || 0) : 1;
  const budget = isGroupDashboard ? perPersonBudget * memberCount : perPersonBudget;
  const tripDuration = validTripDates
    ? Math.round(
        (endDate - startDate) / (1000 * 60 * 60 * 24)
      ) + 1
    : 0;
  let tripStatus = "Add your trip dates to get started";
  let tripLabel = "YOUR NEXT ADVENTURE";
  if (validTripDates) {
    if (today < startDate) {
      const daysUntilTrip = Math.ceil(
        (startDate - today) / (1000 * 60 * 60 * 24)
      );
      tripStatus = `Your trip starts in ${daysUntilTrip} ${
        daysUntilTrip === 1 ? "day" : "days"
      }`;
      tripLabel = "UPCOMING TRIP";
    } else if (today > endDate) {
      tripStatus = "Your trip has been completed";
      tripLabel = "PAST TRIP";
    } else {
      const currentDay =
        Math.floor(
          (today - startDate) / (1000 * 60 * 60 * 24)
        ) + 1;
      tripStatus = `Day ${currentDay} of ${tripDuration}`;
      tripLabel = "CURRENT TRIP";
    }
  }
  const remaining = budget - dashboardTotalSpent;
  const isOverBudget = remaining < 0;
  const spentPercentage =
    budget > 0
      ? Math.min((dashboardTotalSpent / budget) * 100, 100)
      : 0;
  // Group: "everyone" means MY completion, not the group's overall completion.
  // Include private group checklist items in the personal preparation total.
  const privateChecklistItems = isGroupDashboard ? (groupDashboardData?.privateChecklist || []) : [];
  const isChecklistDone = (item) =>
    isGroupDashboard && item.completionMode === "everyone"
      ? item.completedBy?.[user.uid] === true
      : item.completed === true;
  const completedSharedChecklist = dashboardChecklist.filter(isChecklistDone).length;
  const completedPrivateChecklist = privateChecklistItems.filter(item => item.completed === true).length;
  const completedChecklist = completedSharedChecklist + completedPrivateChecklist;
  const checklistTotal = dashboardChecklist.length + privateChecklistItems.length;
  const checklistPercentage = checklistTotal > 0
    ? Math.round((completedChecklist / checklistTotal) * 100) : 0;
  let checklistStatus = "No items added yet";
  if (checklistTotal > 0) {
    if (checklistPercentage === 100) {
      checklistStatus = "Everything is ready!";
    } else if (checklistPercentage >= 50) {
      checklistStatus = "You're making good progress";
    } else {
      checklistStatus = "Let's get prepared";
    }
  }
  const upcomingActivities = dashboardActivities
    .filter(
      (activity) =>
        activity.date && activity.date >= todayString
    )
    .sort((a, b) => {
      const dateComparison = a.date.localeCompare(b.date);
      if (dateComparison !== 0) return dateComparison;
      return (a.time || "").localeCompare(b.time || "");
    })
    .slice(0, 5);
  const getActivityDateLabel = (dateString) => {
    if (dateString === todayString) return "Today";
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowString = [
      tomorrow.getFullYear(),
      String(tomorrow.getMonth() + 1).padStart(2, "0"),
      String(tomorrow.getDate()).padStart(2, "0"),
    ].join("-");
    if (dateString === tomorrowString) return "Tomorrow";
    return formatDate(dateString, {
      day: "2-digit",
      month: "short",
    });
  };
  const displayName =
    profileName?.trim() ||
    user.displayName?.trim() ||
    user.email?.split("@")[0] ||
    "Traveler";
  // ==================== Render ====================
  return (
    <>
    {profileNotice && <div className="profile-save-toast" role="status">{profileNotice}</div>}
    {profileEditing && (
      <div className="profile-modal-backdrop" onMouseDown={(event) => {
        if (event.target === event.currentTarget && !profileSaving) setProfileEditing(false);
      }}>
        <section className="profile-modal" role="dialog" aria-modal="true" aria-labelledby="edit-profile-title">
          <div className="profile-modal-heading">
            <div><h2 id="edit-profile-title">Edit Profile</h2><p>Choose how your name appears in Travel Planner and Groups.</p></div>
            <button type="button" className="profile-modal-close" aria-label="Close" disabled={profileSaving} onClick={() => setProfileEditing(false)}>×</button>
          </div>
          <form onSubmit={saveProfileName}>
            <label htmlFor="profile-username">Username</label>
            <input id="profile-username" type="text" value={profileDraft} onChange={(event) => setProfileDraft(event.target.value)} minLength={2} maxLength={40} autoComplete="nickname" required disabled={profileSaving} autoFocus />
            <p className="profile-modal-hint">2–40 characters. Your email and login credentials will not change.</p>
            {profileError && <p className="profile-modal-error" role="alert">{profileError}</p>}
            <div className="profile-modal-actions">
              <button type="button" className="profile-cancel" disabled={profileSaving} onClick={() => setProfileEditing(false)}>Cancel</button>
              <button type="submit" className="profile-save" disabled={profileSaving}>{profileSaving ? "Saving..." : "Save Changes"}</button>
            </div>
          </form>
        </section>
      </div>
    )}
    {/* ==================== DESKTOP NAVIGATION ==================== */}
<nav className="desktop-nav" aria-label="Main navigation">
  <div className="desktop-nav-brand">
    ✈️ Travel Planner
  </div>
  <div className="desktop-nav-links">
    {[
      { id: "home", label: "Home" },
      { id: "itinerary", label: "Itinerary" },
      { id: "expenses", label: "Expenses" },
      { id: "places", label: "Inspiration" },
      { id: "travel-info", label: "Travel Info" },
    ].map((item) => (
      <button
        key={item.id}
        type="button"
        className={page === item.id ? "active" : ""}
        aria-current={page === item.id ? "page" : undefined}
        onClick={() => goToPage(item.id)}
      >
        {item.label}
      </button>
    ))}
  </div>
</nav>
      {page === "home" && (
        <div className="app">
          <header className="header">
            <div>
              <p className="welcome">Welcome back,</p>
              <h1>{displayName} 👋</h1>
              <p className="header-subtitle">
                Ready for your next adventure?
              </p>
            </div>
            <div className="account-wrapper">
              <button
                type="button"
                className="profile"
                aria-label="Open account menu"
                aria-expanded={showAccountMenu}
                onClick={() =>
                  setShowAccountMenu((previous) => !previous)
                }
              >
                {displayName.charAt(0).toUpperCase()}
              </button>
              {showAccountMenu && (
                <div className="account-menu">
                  <p className="account-email">{user.email}</p>
                  <button type="button" onClick={openProfileEditor}>👤 Edit Profile</button>
                  <button
                    type="button"
                    onClick={() => goToPage("trip-settings")}
                  >
                    ⚙️ Trip Settings
                  </button>
                  <button
                    type="button"
                    onClick={() => goToPage("my-trips")}
                  >
                    ✈️ My Trips
                  </button>

                  <button
                    type="button"
                    onClick={() => goToPage("groups")}
                  >
                    👥 My Groups
                  </button>
                  <button
                    type="button"
                    className="logout-button"
                    onClick={handleLogout}
                  >
                    ↪ Logout
                  </button>
                </div>
              )}
            </div>
          </header>
          <main className="dashboard-main">
            {!isGroupDashboard && selectedTripId && (
                <section className="dashboard-section home-trip-context">
                  <strong>Personal Trip</strong>
                  <p style={{ margin: "6px 0 0" }}>You are viewing this trip's own itinerary, expenses, places, checklist and travel information.</p>
                  <button type="button" onClick={() => goToPage("my-trips")}>Switch trip</button>
                </section>
              )}
              {/* Dashboard Mode Switcher */}
            <section
              className="dashboard-section home-mode-section"
            >
              <div
                style={{
                  display: "flex",
                  gap: "10px",
                  padding: "5px",
                  borderRadius: "16px",
                  background: "#eef3f9",
                }}
              >
                <button
                  type="button"
                  onClick={() => setDashboardMode("personal")}
                  aria-pressed={!isGroupDashboard}
                  style={{
                    flex: 1,
                    border: "none",
                    borderRadius: "12px",
                    padding: "13px 10px",
                    cursor: "pointer",
                    fontWeight: 700,
                    background: !isGroupDashboard
                      ? "#ffffff"
                      : "transparent",
                    color: !isGroupDashboard
                      ? "#2458a6"
                      : "#64748b",
                    boxShadow: !isGroupDashboard
                      ? "0 2px 8px rgba(30, 64, 120, 0.08)"
                      : "none",
                  }}
                >
                  👤 Personal Trip
                </button>
                <button
                  type="button"
                  onClick={() => setDashboardMode("group")}
                  aria-pressed={isGroupDashboard}
                  style={{
                    flex: 1,
                    border: "none",
                    borderRadius: "12px",
                    padding: "13px 10px",
                    cursor: "pointer",
                    fontWeight: 700,
                    background: isGroupDashboard
                      ? "#ffffff"
                      : "transparent",
                    color: isGroupDashboard
                      ? "#2458a6"
                      : "#64748b",
                    boxShadow: isGroupDashboard
                      ? "0 2px 8px rgba(30, 64, 120, 0.08)"
                      : "none",
                  }}
                >
                  👥 Group Trip
                </button>
              </div>
            </section>
            {/* Group Selector */}
            {isGroupDashboard && (
              <section className="dashboard-section">
                {groupsLoaded && userGroups.length > 0 && (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: "12px",
                      flexWrap: "wrap",
                      marginBottom: "18px",
                    }}
                  >
                    <div>
                      <p className="eyebrow">TRAVEL TOGETHER</p>
                      <h2 style={{ margin: 0 }}>Choose a group</h2>
                    </div>
                    <select
                      aria-label="Select group trip"
                      value={selectedGroupId}
                      onChange={(event) =>
                        setSelectedGroupId(event.target.value)
                      }
                      style={{
                        maxWidth: "100%",
                        minWidth: "180px",
                        padding: "12px",
                        border: "1px solid #dbe4ef",
                        borderRadius: "12px",
                        background: "#ffffff",
                        color: "#243247",
                        font: "inherit",
                      }}
                    >
                      {userGroups.map((group) => (
                        <option key={group.id} value={group.id}>
                          {group.tripSettings?.name ||
                            group.name ||
                            "Untitled group"}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                {!groupsLoaded && (
                  <div className="empty-home">
                    <div className="empty-icon">👥</div>
                    <h3>Loading your groups...</h3>
                    <p>Please wait while we load your shared trips.</p>
                  </div>
                )}
                {groupsLoaded && userGroups.length === 0 && (
                  <div className="empty-home">
                    <div className="empty-icon">✈️</div>
                    <h3>No group trips yet</h3>
                    <p>
                      Create a group or join a friend's group to start
                      planning a trip together.
                    </p>
                    <button
                      type="button"
                      className="empty-action"
                      onClick={() => goToPage("groups")}
                    >
                      Go to My Groups <span>→</span>
                    </button>
                  </div>
                )}
                {groupError && (
                  <div className="empty-home">
                    <h3>Unable to load group data</h3>
                    <p>{groupError}</p>
                    <button
                      type="button"
                      className="empty-action"
                      onClick={() => goToPage("groups")}
                    >
                      Open My Groups <span>→</span>
                    </button>
                  </div>
                )}
                {groupLoading && (
                  <div className="empty-home">
                    <div className="empty-icon">🌍</div>
                    <h3>Loading shared trip...</h3>
                    <p>
                      Getting the group's trip, expenses and checklist.
                    </p>
                  </div>
                )}
              </section>
            )}
<div className="dashboard-card-grid">
            {/* Trip Overview */}
            {(!isGroupDashboard || groupDashboardData) &&
              !groupLoading &&
              !groupError &&
              (
                dashboardHasTrip ? (
                  <section className="trip-card home-hero">
                    <div className="trip-card-content">
                      <p className="trip-label">
                        {isGroupDashboard
                          ? "SHARED GROUP TRIP"
                          : tripLabel}
                      </p>
                      <h2>
                        {dashboardTrip.name || "My Trip"}
                      </h2>
                      <p className="trip-destination">
                        <span>📍</span>{" "}
                        {dashboardTrip.destination ||
                          "Destination not set"}
                      </p>
                      <p className="trip-date">
                        {formatDate(dashboardTrip.startDate, {
                          day: "2-digit",
                          month: "short",
                        })}
                        {" — "}
                        {formatDate(dashboardTrip.endDate, {
                          day: "2-digit",
                          month: "short",
                          year: "numeric",
                        })}
                      </p>
                      {tripDuration > 0 && (
                        <span className="trip-duration-pill">
                          {tripDuration}{" "}
                          {tripDuration === 1 ? "day" : "days"}
                        </span>
                      )}
                      <p className="trip-status">
                        <span className="status-dot" />
                        {isGroupDashboard
                          ? tripStatus
                          : tripStatus}
                      </p>
                      <button
                        type="button"
                        className="trip-edit-link"
                        onClick={() =>
                          goToPage(
                            isGroupDashboard
                              ? "groups"
                              : "trip-settings"
                          )
                        }
                      >
                        {isGroupDashboard
                          ? "Manage group trip"
                          : "Edit trip details"}{" "}
                        <span>↗</span>
                      </button>
                    </div>
                    <div className="trip-icon" aria-hidden="true">
                      {isGroupDashboard ? "🌍" : "✈️"}
                    </div>
                    <div className="trip-decoration" aria-hidden="true">
                      +
                    </div>
                  </section>
                ) : (
                  <section className="setup-trip-card">
                    <div className="setup-trip-icon">🧭</div>
                    <p className="trip-label">
                      LET'S GET STARTED
                    </p>
                    <h2>
                      {isGroupDashboard
                        ? "Set up your shared trip"
                        : "Plan your next adventure"}
                    </h2>
                    <p>
                      {isGroupDashboard
                        ? "Ask the group owner to add the destination, dates and budget in Shared Trip Settings."
                        : personalError || "Create a personal trip to start planning your next adventure."}
                    </p>
                    <button
                      type="button"
                      className="primary-button"
                      onClick={() =>
                        goToPage(
                          isGroupDashboard
                            ? "groups"
                            : "my-trips"
                        )
                      }
                    >
                      {isGroupDashboard
                        ? "Open group settings"
                        : "Go to My Trips"}{" "}
                      <span>→</span>
                    </button>
                  </section>
                )
              )}
            {/* Group Members */}
            {isGroupDashboard && selectedGroup && (
              <section className="dashboard-section">
                <div className="section-heading">
                  <div>
                    <p className="eyebrow">YOUR TRAVEL TEAM</p>
                    <h2>Group members</h2>
                  </div>
                  <button
                    type="button"
                    className="text-link"
                    onClick={() => goToPage("groups")}
                  >
                    Manage group <span>→</span>
                  </button>
                </div>
                <div className="home-checklist-card">
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "14px",
                    }}
                  >
                    <div className="checklist-icon">👥</div>
                    <div className="checklist-count">
                      <strong>
                        {(selectedGroup.memberIds || []).length}
                      </strong>
                      <p>
                        {(selectedGroup.memberIds || []).length === 1
                          ? "traveler in this group"
                          : "travelers in this group"}
                      </p>
                    </div>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: "8px",
                      marginTop: "16px",
                    }}
                  >
                    {(selectedGroup.memberIds || []).map(
                      (memberId, index) => (
                        <span
                          key={memberId}
                          style={{
                            padding: "7px 11px",
                            borderRadius: "999px",
                            background: "#eef3f9",
                            color: "#334155",
                            fontSize: "13px",
                          }}
                        >
                          {memberId === user.uid
                            ? `${displayName} (You)`
                            : `Member ${index + 1}`}
                          {memberId === selectedGroup.ownerId
                            ? " · Owner"
                            : ""}
                        </span>
                      )
                    )}
                  </div>
                </div>
              </section>
            )}
            {/* Budget Overview */}
            {(!isGroupDashboard || groupDashboardData) &&
              !groupLoading &&
              !groupError && (
                <section className="dashboard-section budget-section">
                  <div className="section-heading">
                    <div>
                      <p className="eyebrow">
                        {isGroupDashboard
                          ? "YOUR GROUP TRIP FINANCES"
                          : "YOUR FINANCES"}
                      </p>
                      <h2>Budget overview</h2>
                    </div>
                    <button
                      type="button"
                      className="text-link"
                      onClick={() => goToPage("expenses")}
                    >
                      View expenses <span>→</span>
                    </button>
                  </div>
                  <div className={`budget-card ${isGroupDashboard ? "budget-card-group" : ""}`}>
                    <div className="budget-top">
                      <div>
                        <p className="budget-caption">{isGroupDashboard ? "TOTAL GROUP BUDGET" : "TOTAL TRIP BUDGET"}</p>
                        <h3>RM {budget.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</h3>
                      </div>
                      <div className="budget-top-actions">
                        <div className="budget-icon" aria-hidden="true">💰</div>
                      </div>
                    </div>
                    {isGroupDashboard ? (
                      <>
                        <div className="budget-group-summary">
                          <div className="budget-group-remaining">
                            <span>Remaining budget</span>
                            <strong className={isOverBudget ? "budget-negative" : ""}>RM {Math.abs(remaining).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{isOverBudget ? " over budget" : ""}</strong>
                          </div>
                          <div className="budget-progress-heading"><span>Budget used</span><strong>{Math.round(spentPercentage)}%</strong></div>
                          <div className="progress" role="progressbar" aria-label="Group budget used" aria-valuenow={Math.round(spentPercentage)} aria-valuemin={0} aria-valuemax={100}>
                            <div className={`progress-bar ${isOverBudget ? "progress-bar-over" : ""}`} style={{ width: `${spentPercentage}%` }} />
                          </div>
                        </div>
                        <div className="budget-metrics">
                          <div className="budget-metric"><span className="metric-dot planned-dot" /><p>Planned</p><strong>RM {dashboardTotalPlanned.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></div>
                          <div className="budget-metric"><span className="metric-dot spent-dot" /><p>Group Spending</p><strong>RM {dashboardTotalSpent.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></div>
                        </div>
                        <div className="budget-group-total">
                          <div><span>Budget per person</span><strong>RM {perPersonBudget.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></div>
                          <span className="budget-group-tag">{memberCount} members</span>
                        </div>
                        <p className="budget-group-note">Each member has the budget shown above. Total group budget = per-person budget × members. The owner can edit the per-person budget in My Groups. Private expenses and repayments are excluded.</p>
                      </>
                    ) : (
                      <>
                        <div className="budget-metrics">
                          <div className="budget-metric"><span className="metric-dot planned-dot" /><p>Planned</p><strong>RM {dashboardTotalPlanned.toLocaleString("en-MY")}</strong></div>
                          <div className="budget-metric"><span className="metric-dot spent-dot" /><p>Spent</p><strong>RM {dashboardTotalSpent.toLocaleString("en-MY")}</strong></div>
                        </div>
                        <div className="budget-progress-heading"><span>Budget used</span><strong>{Math.round(spentPercentage)}%</strong></div>
                        <div className="progress" role="progressbar" aria-label="Trip budget used" aria-valuenow={Math.round(spentPercentage)} aria-valuemin={0} aria-valuemax={100}>
                          <div className={`progress-bar ${isOverBudget ? "progress-bar-over" : ""}`} style={{ width: `${spentPercentage}%` }} />
                        </div>
                        <div className={`remaining ${isOverBudget ? "over-budget" : ""}`}><span>{isOverBudget ? "You've exceeded your budget by" : "Remaining budget"}</span><strong>RM {Math.abs(remaining).toLocaleString("en-MY")}</strong></div>
                      </>
                    )}
                  </div>
                </section>
              )}
            {/* Upcoming Activities */}
            {(!isGroupDashboard || groupDashboardData) &&
              !groupLoading &&
              !groupError && (
                <section className="dashboard-section activities-section">
                  <div className="section-heading">
                    <div>
                      <p className="eyebrow">
                        {isGroupDashboard
                          ? "SHARED SCHEDULE"
                          : "YOUR SCHEDULE"}
                      </p>
                      <h2>Upcoming activities</h2>
                    </div>
                    <button
                      type="button"
                      className="text-link"
                      onClick={() => goToPage("itinerary")}
                    >
                      View itinerary <span>→</span>
                    </button>
                  </div>
                  {upcomingActivities.length === 0 ? (
                    <div className="empty-home">
                      <div className="empty-icon">🗓️</div>
                      <h3>Your schedule is clear</h3>
                      <p>
                        Add activities to your itinerary and they will
                        appear here.
                      </p>
                      <button
                        type="button"
                        className="empty-action"
                        onClick={() => goToPage("itinerary")}
                      >
                        Plan an activity <span>→</span>
                      </button>
                    </div>
                  ) : (
                    <div className="activity-list">
                      {upcomingActivities.map((activity) => (
                        <div className="activity" key={activity.id}>
                          <div className="activity-date-block">
                            <span>
                              {getActivityDateLabel(activity.date)}
                            </span>
                            <strong>{activity.time || "Anytime"}</strong>
                          </div>
                          <div className="activity-icon">📍</div>
                          <div className="activity-info">
                            <h3>
                              {activity.title || "Untitled activity"}
                            </h3>
                            <p>
                              {activity.location || "Location not set"}
                            </p>
                          </div>
                          <span className="activity-arrow">›</span>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              )}
            {/* Checklist Progress */}
            {(!isGroupDashboard || groupDashboardData) &&
              !groupLoading &&
              !groupError && (
                <section className="dashboard-section home-checklist">
                  <div className="section-heading">
                    <div>
                      <p className="eyebrow">
                        {isGroupDashboard
                          ? "GROUP PREPARATION"
                          : "TRAVEL PREPARATION"}
                      </p>
                      <h2>
                        {isGroupDashboard
                          ? "Group readiness"
                          : "Getting ready"}
                      </h2>
                    </div>
                    <button
                      type="button"
                      className="text-link"
                      onClick={() => goToPage("checklist")}
                    >
                      Checklist <span>→</span>
                    </button>
                  </div>
                  <div className="home-checklist-card">
                    <div className="checklist-card-top">
                      <div className="checklist-icon">☑️</div>
                      <div className="checklist-count">
                        <strong>
                          {completedChecklist}
                          <span> / {checklistTotal}</span>
                        </strong>
                        <p>items completed</p>
                      </div>
                      <div className="checklist-percentage">
                        {checklistPercentage}%
                      </div>
                    </div>
                    <div className="home-progress">
                      <div
                        style={{
                          width: `${checklistPercentage}%`,
                        }}
                      />
                    </div>
                    <p className="checklist-status">
                      {checklistStatus}
                    </p>
                  </div>
                </section>
              )}
            {/* Quick Access */}
            <section className="dashboard-section quick-actions">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">MADE FOR YOUR JOURNEY</p>
                  <h2>Quick access</h2>
                </div>
              </div>
              <div className="action-grid">
                <button
                  type="button"
                  className="action-card action-itinerary"
                  onClick={() => goToPage("itinerary")}
                >
                  <span className="action-icon">🗓️</span>
                  <span className="action-text">
                    <strong>Itinerary</strong>
                    <small>Plan your days</small>
                  </span>
                  <span className="action-arrow">↗</span>
                </button>
                <button
                  type="button"
                  className="action-card action-expenses"
                  onClick={() => goToPage("expenses")}
                >
                  <span className="action-icon">💳</span>
                  <span className="action-text">
                    <strong>Expenses</strong>
                    <small>Track your budget</small>
                  </span>
                  <span className="action-arrow">↗</span>
                </button>
                <button
                  type="button"
                  className="action-card action-places"
                  onClick={() => goToPage("places")}
                >
                  <span className="action-icon">📍</span>
                  <span className="action-text">
                    <strong>Travel Inspiration</strong>
                    <small>Save ideas & places</small>
                  </span>
                  <span className="action-arrow">↗</span>
                </button>
                <button
                  type="button"
                  className="action-card action-checklist"
                  onClick={() => goToPage("checklist")}
                >
                  <span className="action-icon">☑️</span>
                  <span className="action-text">
                    <strong>Checklist</strong>
                    <small>Pack with confidence</small>
                  </span>
                  <span className="action-arrow">↗</span>
                </button>
                <button
                  type="button"
                  className="action-card action-travel-info"
                  onClick={() => goToPage("travel-info")}
                >
                  <span className="action-icon">🧳</span>
                  <span className="action-text">
                    <strong>Travel info</strong>
                    <small>Bookings and contacts</small>
                  </span>
                  <span className="action-arrow">↗</span>
                </button>
                <button
                  type="button"
                  className="action-card action-groups"
                  onClick={() => goToPage("groups")}
                >
                  <span className="action-icon">👥</span>
                  <span className="action-text">
                    <strong>Groups</strong>
                    <small>Plan together</small>
                  </span>
                  <span className="action-arrow">↗</span>
                </button>
               </div>
            </section>
          </div> {/* End dashboard-card-grid */}
          </main>
        </div>
      )}
{/* ==================== OTHER PAGES ==================== */}
{page === "my-trips" && (
  <MyTrips
    selectedTripId={selectedTripId}
    onSelectTrip={(tripId) => {
      setSelectedTripId(tripId);
      if (user?.uid) saveSelectedTripId(user.uid, tripId);
      setDashboardMode("personal");
      goToPage("home");
    }}
    onBack={() => goToPage("home")}
  />
)}

{page === "itinerary" && (
  <Itinerary
    trip={trip}
    selectedTripId={selectedTripId}
    dashboardMode={dashboardMode}
    onDashboardModeChange={setDashboardMode}
    selectedGroupId={selectedGroupId}
    onSelectedGroupChange={setSelectedGroupId}
  />
)}
{page === "expenses" && (
  <Expenses
    trip={trip}
    selectedTripId={selectedTripId}
    dashboardMode={dashboardMode}
    onDashboardModeChange={setDashboardMode}
    selectedGroupId={selectedGroupId}
    onSelectedGroupChange={setSelectedGroupId}
    onOpenGroups={() => goToPage("groups")}
  />
)}
{page === "places" && (
    <Places
      trip={trip}
      selectedTripId={selectedTripId}
      dashboardMode={dashboardMode}
      onDashboardModeChange={setDashboardMode}
      selectedGroupId={selectedGroupId}
      onSelectedGroupChange={setSelectedGroupId}
    />
)}
{page === "checklist" && (
  <Checklist
    trip={trip}
    selectedTripId={selectedTripId}
    dashboardMode={dashboardMode}
    onDashboardModeChange={setDashboardMode}
    selectedGroupId={selectedGroupId}
    onSelectedGroupChange={setSelectedGroupId}
  />
)}
{page === "travel-info" && (
  <TravelInfo
      selectedTripId={selectedTripId}
      trip={dashboardMode === "group" ? groupDashboardData?.trip || trip : trip}
      dashboardMode={dashboardMode}
      selectedGroupId={selectedGroupId}
      onSelectedGroupChange={setSelectedGroupId}
    />
)}
      {page === "trip-settings" && (
        <TripSettings
          selectedTripId={selectedTripId}
          onSave={async () => {
            setPersonalRefresh((n) => n + 1);
            goToPage("home");
          }}
          onBack={() => goToPage("home")}
        />
      )}
      {page === "groups" && <Groups />}
      {/* ==================== BOTTOM NAVIGATION ==================== */}
      <nav className="bottom-nav" aria-label="Mobile navigation">
        <button
          type="button"
          className={page === "home" ? "active" : ""}
          aria-current={page === "home" ? "page" : undefined}
          onClick={() => goToPage("home")}
        >
          <span className="nav-icon">⌂</span>
          <span>Home</span>
        </button>
        <button
          type="button"
          className={page === "itinerary" ? "active" : ""}
          aria-current={page === "itinerary" ? "page" : undefined}
          onClick={() => goToPage("itinerary")}
        >
          <span className="nav-icon">▦</span>
          <span>Plan</span>
        </button>
        <button
          type="button"
          className={page === "expenses" ? "active" : ""}
          aria-current={page === "expenses" ? "page" : undefined}
          onClick={() => goToPage("expenses")}
        >
          <span className="nav-icon">＄</span>
          <span>Expenses</span>
        </button>
        <button
          type="button"
          className={page === "places" ? "active" : ""}
          aria-current={page === "places" ? "page" : undefined}
          onClick={() => goToPage("places")}
        >
          <span className="nav-icon">⌖</span>
          <span>Places</span>
        </button>
        <button
          type="button"
          className={page === "travel-info" ? "active" : ""}
          aria-current={page === "travel-info" ? "page" : undefined}
          onClick={() => goToPage("travel-info")}
        >
          <span className="nav-icon">✈</span>
          <span>Travel info</span>
        </button>
      </nav>
    </>
  );
}
export default App;