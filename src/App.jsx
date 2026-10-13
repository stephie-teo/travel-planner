
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
} from "firebase/auth";

import {
  doc,
  getDoc,
  collection,
  getDocs,
  query,
  where,
  onSnapshot,
} from "firebase/firestore";

import { useEffect, useState } from "react";

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
  const [hasTrip, setHasTrip] = useState(false);
  const [tripLoaded, setTripLoaded] = useState(false);

  const [activities, setActivities] = useState([]);
  const [totalSpent, setTotalSpent] = useState(0);
  const [totalPlanned, setTotalPlanned] = useState(0);
  const [checklist, setChecklist] = useState([]);

  // Group Dashboard state
  const [dashboardMode, setDashboardMode] = useState("personal");
  const [userGroups, setUserGroups] = useState([]);
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [groupDashboardData, setGroupDashboardData] = useState(null);
  const [groupLoading, setGroupLoading] = useState(false);
  const [groupError, setGroupError] = useState("");
  const [groupsLoaded, setGroupsLoaded] = useState(false);

  const [page, setPage] = useState("home");
  const [showAccountMenu, setShowAccountMenu] = useState(false);

  // ==================== Firebase Auth ====================

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setTrip(null);
      setHasTrip(false);
      setTripLoaded(false);

      setActivities([]);
      setTotalSpent(0);
      setTotalPlanned(0);
      setChecklist([]);

      setDashboardMode("personal");
      setUserGroups([]);
      setSelectedGroupId("");
      setGroupDashboardData(null);
      setGroupLoading(false);
      setGroupError("");
      setGroupsLoaded(false);

      setUser(currentUser);
      setPage("home");
      setShowAccountMenu(false);
    });

    return () => unsubscribe();
  }, []);

  // ==================== Load Personal Trip ====================

  const loadTrip = async () => {
    if (!user) return;

    setTripLoaded(false);

    try {
      const tripRef = doc(
        db,
        "users",
        user.uid,
        "settings",
        "trip"
      );

      const tripSnap = await getDoc(tripRef);

      if (tripSnap.exists()) {
        setTrip(tripSnap.data());
        setHasTrip(true);
      } else {
        setTrip({ ...EMPTY_TRIP });
        setHasTrip(false);
      }
    } catch (error) {
      console.error("Failed to load dashboard trip:", error);
      setTrip({ ...EMPTY_TRIP });
      setHasTrip(false);
    } finally {
      setTripLoaded(true);
    }
  };

  // ==================== Load Personal Expenses ====================

  const loadExpenses = async () => {
    if (!user) return;

    try {
      const expensesRef = collection(
        db,
        "users",
        user.uid,
        "expenses"
      );

      const snapshot = await getDocs(expensesRef);

      let planned = 0;
      let actual = 0;

      snapshot.forEach((expenseDoc) => {
        const expense = expenseDoc.data();

        planned += Number(expense.plannedAmount) || 0;
        actual += Number(expense.actualAmount) || 0;
      });

      setTotalPlanned(planned);
      setTotalSpent(actual);
    } catch (error) {
      console.error("Failed to load dashboard expenses:", error);
    }
  };

  // ==================== Load Personal Activities ====================

  const loadActivities = async () => {
    if (!user) return;

    try {
      const activitiesRef = collection(
        db,
        "users",
        user.uid,
        "activities"
      );

      const snapshot = await getDocs(activitiesRef);

      setActivities(
        snapshot.docs.map((item) => ({
          id: item.id,
          ...item.data(),
        }))
      );
    } catch (error) {
      console.error("Failed to load dashboard activities:", error);
    }
  };

  // ==================== Load Personal Checklist ====================

  const loadChecklist = async () => {
    if (!user) return;

    try {
      const checklistRef = collection(
        db,
        "users",
        user.uid,
        "checklist"
      );

      const snapshot = await getDocs(checklistRef);

      setChecklist(
        snapshot.docs.map((item) => ({
          id: item.id,
          ...item.data(),
        }))
      );
    } catch (error) {
      console.error("Failed to load dashboard checklist:", error);
    }
  };

  useEffect(() => {
    if (user) {
      loadTrip();
      loadExpenses();
      loadActivities();
      loadChecklist();
    }
  }, [user]);

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

    setGroupDashboardData({
      group: groupData,
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

  // Clean up all listeners when the user changes group,
  // switches to Personal Trip, logs out, or unmounts App.
  return () => {
    cancelled = true;

    unsubscribeGroup();
    unsubscribeActivities();
    unsubscribeExpenses();
    unsubscribeChecklist();
  };
}, [user, dashboardMode, selectedGroupId]);

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
    setPage(nextPage);
    setShowAccountMenu(false);

    if (nextPage === "home") {
      loadTrip();
      loadExpenses();
      loadActivities();
      loadChecklist();

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
    ? groupDashboardData?.totalSpent || 0
    : totalSpent;

  const dashboardTotalPlanned = isGroupDashboard
    ? groupDashboardData?.totalPlanned || 0
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

  const budget = Number(dashboardTrip.budget) || 0;

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

  const completedChecklist = dashboardChecklist.filter(
    (item) => item.completed
  ).length;

  const checklistPercentage =
    dashboardChecklist.length > 0
      ? Math.round(
          (completedChecklist / dashboardChecklist.length) * 100
        )
      : 0;

  let checklistStatus = "No items added yet";

  if (dashboardChecklist.length > 0) {
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
    user.displayName?.trim() ||
    user.email?.split("@")[0] ||
    "Traveler";

  // ==================== Render ====================

  return (
    <>
    {/* ==================== DESKTOP NAVIGATION ==================== */}

<nav className="desktop-nav">
  <div className="desktop-nav-brand">
    ✈️ Travel Planner
  </div>

  <div className="desktop-nav-links">
    {[
      { id: "home", label: "Home" },
      { id: "itinerary", label: "Itinerary" },
      { id: "expenses", label: "Expenses" },
      { id: "places", label: "Places" },
      { id: "travel-info", label: "Travel Info" },
    ].map((item) => (
      <button
        key={item.id}
        type="button"
        className={page === item.id ? "active" : ""}
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
            {/* Dashboard Mode Switcher */}

            <section
              className="dashboard-section"
              style={{ marginBottom: "20px" }}
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
                  <section className="trip-card">
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
                        : "Add your destination, travel dates and budget to get your personal trip dashboard ready."}
                    </p>

                    <button
                      type="button"
                      className="primary-button"
                      onClick={() =>
                        goToPage(
                          isGroupDashboard
                            ? "groups"
                            : "trip-settings"
                        )
                      }
                    >
                      {isGroupDashboard
                        ? "Open group settings"
                        : "Set up my trip"}{" "}
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
                          ? "SHARED FINANCES"
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

                  <div className="budget-card">
                    <div className="budget-top">
                      <div>
                        <p className="budget-caption">
                          {isGroupDashboard
                            ? "TOTAL GROUP BUDGET"
                            : "TOTAL TRIP BUDGET"}
                        </p>
                        <h3>
                          RM {budget.toLocaleString("en-MY")}
                        </h3>
                      </div>

                      <div className="budget-icon">💰</div>
                    </div>

                    <div className="budget-metrics">
                      <div className="budget-metric">
                        <span className="metric-dot planned-dot" />
                        <p>Planned</p>
                        <strong>
                          RM{" "}
                          {dashboardTotalPlanned.toLocaleString("en-MY")}
                        </strong>
                      </div>

                      <div className="budget-metric">
                        <span className="metric-dot spent-dot" />
                        <p>Spent</p>
                        <strong>
                          RM{" "}
                          {dashboardTotalSpent.toLocaleString("en-MY")}
                        </strong>
                      </div>
                    </div>

                    <div className="budget-progress-heading">
                      <span>Budget used</span>
                      <strong>{Math.round(spentPercentage)}%</strong>
                    </div>

                    <div
                      className="progress"
                      role="progressbar"
                      aria-label="Trip budget used"
                      aria-valuenow={Math.round(spentPercentage)}
                      aria-valuemin={0}
                      aria-valuemax={100}
                    >
                      <div
                        className={`progress-bar ${
                          isOverBudget ? "progress-bar-over" : ""
                        }`}
                        style={{ width: `${spentPercentage}%` }}
                      />
                    </div>

                    <div
                      className={`remaining ${
                        isOverBudget ? "over-budget" : ""
                      }`}
                    >
                      <span>
                        {isOverBudget
                          ? "You've exceeded your budget by"
                          : "Remaining budget"}
                      </span>

                      <strong>
                        RM{" "}
                        {Math.abs(remaining).toLocaleString("en-MY")}
                      </strong>
                    </div>
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
                          <span> / {dashboardChecklist.length}</span>
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
                    <strong>Places</strong>
                    <small>Save destinations</small>
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
  <MyTrips onBack={() => goToPage("home")} />
)}

{page === "itinerary" && (
  <Itinerary
    trip={trip}
    dashboardMode={dashboardMode}
    onDashboardModeChange={setDashboardMode}
    selectedGroupId={selectedGroupId}
    onSelectedGroupChange={setSelectedGroupId}
  />
)}

{page === "expenses" && (
  <Expenses
    trip={trip}
    dashboardMode={dashboardMode}
    onDashboardModeChange={setDashboardMode}
    selectedGroupId={selectedGroupId}
    onSelectedGroupChange={setSelectedGroupId}
  />
)}

{page === "places" && (
    <Places
      trip={trip}
      dashboardMode={dashboardMode}
      onDashboardModeChange={setDashboardMode}
      selectedGroupId={selectedGroupId}
      onSelectedGroupChange={setSelectedGroupId}
    />
)}

{page === "checklist" && (
  <Checklist
    trip={trip}
    dashboardMode={dashboardMode}
    onDashboardModeChange={setDashboardMode}
    selectedGroupId={selectedGroupId}
    onSelectedGroupChange={setSelectedGroupId}
  />
)}

{page === "travel-info" && (
  <TravelInfo
      trip={dashboardMode === "group" ? groupDashboardData?.trip || trip : trip}
      dashboardMode={dashboardMode}
      selectedGroupId={selectedGroupId}
      onSelectedGroupChange={setSelectedGroupId}
    />
)}
      {page === "trip-settings" && (
        <TripSettings
          onSave={async () => {
            await loadTrip();
            goToPage("home");
          }}
          onBack={() => goToPage("home")}
        />
      )}

      {page === "groups" && <Groups />}

      {/* ==================== BOTTOM NAVIGATION ==================== */}

      <nav className="bottom-nav">
        <button
          type="button"
          className={page === "home" ? "active" : ""}
          onClick={() => goToPage("home")}
        >
          <span className="nav-icon">⌂</span>
          <span>Home</span>
        </button>

        <button
          type="button"
          className={page === "itinerary" ? "active" : ""}
          onClick={() => goToPage("itinerary")}
        >
          <span className="nav-icon">▦</span>
          <span>Plan</span>
        </button>

        <button
          type="button"
          className={page === "expenses" ? "active" : ""}
          onClick={() => goToPage("expenses")}
        >
          <span className="nav-icon">＄</span>
          <span>Expenses</span>
        </button>

        <button
          type="button"
          className={page === "places" ? "active" : ""}
          onClick={() => goToPage("places")}
        >
          <span className="nav-icon">⌖</span>
          <span>Places</span>
        </button>

        <button
          type="button"
          className={page === "travel-info" ? "active" : ""}
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