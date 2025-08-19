// ===============================================
// GymTracker Pro - Main JavaScript Module
// ===============================================

// Import Firebase modules
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";
import { initializeAppCheck, ReCaptchaV3Provider, getToken } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app-check.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-analytics.js";
import { 
    getAuth, 
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    signInWithPopup,
    GoogleAuthProvider,
    onAuthStateChanged,
    signOut as firebaseSignOut,
    sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import { initializeFirestore, collection, addDoc, query, where, orderBy, onSnapshot, 
  deleteDoc, doc, getDocs, updateDoc, serverTimestamp, Timestamp, setDoc, getDoc, limit as qLimit, deleteField
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

import {
  getStorage,
  ref,
  uploadBytes,           // <-- added
  uploadBytesResumable,  // (kept in case used elsewhere)
  getDownloadURL,
  deleteObject
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-storage.js";

// ===============================================
// Firebase Configuration
// ===============================================
const firebaseConfig = {
  apiKey: "AIzaSyBh37LFOyhCsyy5UOULCLL5_GUJbSHelJ4",
  authDomain: "gymtracker-pro-7ac65.firebaseapp.com",
  projectId: "gymtracker-pro-7ac65",
  storageBucket: "gymtracker-pro-7ac65.firebasestorage.app",
  appId: "1:321858828026:web:7deb1cbcc162d5bf2f7b43",
  measurementId: "G-2EZ01FJ9E2"
};
// Initialize Firebase
const app = initializeApp(firebaseConfig);

// ---- Host flags
const HOST = location.hostname;
const IS_LOCAL =
  HOST === 'localhost' || HOST === '127.0.0.1';
const IS_PROD_HOST =
  /\.pages\.dev$/.test(HOST) ||
  /\.web\.app$/.test(HOST) ||
  /\.firebaseapp\.com$/.test(HOST);

// ---- App Check (reCAPTCHA v3) — only on production hosts
try {
  if (IS_PROD_HOST) {
    // If you want to test with a debug token on prod-like hosts, set it manually in DevTools:
    // localStorage.setItem('APPCHECK_DEBUG_TOKEN', '<your-debug-token>');
    // self.FIREBASE_APPCHECK_DEBUG_TOKEN = localStorage.getItem('APPCHECK_DEBUG_TOKEN');

    const appCheck = initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider('6LcUV6krAAAAAL0pL1T_ZwZ5uS-V6LkhN9-UIVbO'),
      isTokenAutoRefreshEnabled: true
    });

    // Helper to verify App Check token issuance
    window.logAppCheck = async () => {
      try {
        const t = await getToken(appCheck, true);
        console.log('[AppCheck] token (first 16):', t?.token?.slice(0, 16), '...');
      } catch (err) {
        console.warn('[AppCheck] getToken failed:', err?.message || err);
      }
    };
  } else {
    console.info('[AppCheck] Skipped on localhost/dev host.');
  }
} catch (e) {
  console.warn('App Check init failed:', e?.message || e);
}

// ---- Analytics (only on real hosts)
let analytics = null;
if (IS_PROD_HOST) {
  try { analytics = getAnalytics(app); }
  catch (e) { console.warn('Analytics init skipped:', e?.message || e); }
}

const auth = getAuth(app);
// Optional: keep UI prompts in English (helps with consistent error strings)
auth.languageCode = 'en';
const db = initializeFirestore(app, {
  experimentalAutoDetectLongPolling: true,
  useFetchStreams: false
});
const storage = getStorage(app, "gs://gymtracker-pro-7ac65.firebasestorage.app");
Object.assign(window, { auth, db, storage, getAuth, getStorage, ref, getDownloadURL });

// ===============================================
// Global Variables
// ===============================================
let currentUser = null;
let workoutTimer = null;
let workoutStartTime = null;
let currentWorkout = null;
let exerciseLibrary = [];
let userRoutines = [];
let muscleResetTimer = null;

// Weight chart and range state.  The weightChart instance will hold the
// Chart.js line chart used in the weight progress section.  The
// currentWeightRange determines how many days of weight data to
// display (default 30 days).
let weightChart = null;
let currentWeightRange = 30;

// ===============================================
// Dashboard Stats Helper
//
// Computes the current streak and weekly PR count and updates the
// corresponding elements in the DOM. This is called whenever user
// data is loaded or updated. A missing element is ignored gracefully.
function updateDashboardStats(userData) {
    try {
        const streakEl = document.getElementById('streak-days');
        const prsWeekEl = document.getElementById('prs-week');
        if (streakEl) {
            // Default to the stored streak. If the last workout is older
            // than a day and the user hasn’t worked out today, reset to 0
            let streak = userData?.stats?.currentStreak || 0;
            try {
                const lastWorkoutTS = userData?.stats?.lastWorkout;
                if (lastWorkoutTS?.toDate) {
                    const lastDate = lastWorkoutTS.toDate();
                    const nowDate = new Date();
                    const diffDays = Math.floor((nowDate - lastDate) / (24 * 60 * 60 * 1000));
                    if (diffDays > 1) {
                        // If the last workout was more than one day ago, show 0 to
                        // indicate the streak has been broken. The streak will
                        // reset to 1 when the next workout is completed.
                        streak = 0;
                    } else if (diffDays === 0) {
                        // If a second workout occurs on the same day, keep the current streak
                        streak = userData?.stats?.currentStreak || 0;
                    }
                }
            } catch (_) {
                // ignore errors and keep default streak
            }
            streakEl.textContent = streak;
        }
        if (prsWeekEl) {
            const prs = userData?.stats?.personalRecords || {};
            let count = 0;
            const now = new Date();
            const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            Object.values(prs).forEach(record => {
                if (record?.date?.toDate) {
                    const d = record.date.toDate();
                    if (d >= oneWeekAgo) count++;
                } else {
                    count++;
                }
            });
            prsWeekEl.textContent = count;
        }
    } catch (err) {
        console.warn('updateDashboardStats() failed', err?.message || err);
    }
}

// ===============================================
// Exercise Library Data
// ===============================================
const defaultExercises = [
    // Chest
    { name: "Bench Press", category: "chest", muscles: ["Pectorals", "Triceps", "Front Delts"], difficulty: 3 },
    { name: "Incline Dumbbell Press", category: "chest", muscles: ["Upper Chest", "Front Delts"], difficulty: 3 },
    { name: "Push-ups", category: "chest", muscles: ["Pectorals", "Triceps"], difficulty: 1 },
    { name: "Cable Fly", category: "chest", muscles: ["Pectorals"], difficulty: 2 },
    { name: "Dips", category: "chest", muscles: ["Lower Chest", "Triceps"], difficulty: 3 },
    
    // Back
    { name: "Pull-ups", category: "back", muscles: ["Lats", "Biceps"], difficulty: 3 },
    { name: "Deadlift", category: "back", muscles: ["Lower Back", "Glutes", "Hamstrings"], difficulty: 4 },
    { name: "Bent Over Row", category: "back", muscles: ["Mid Back", "Lats", "Biceps"], difficulty: 3 },
    { name: "Lat Pulldown", category: "back", muscles: ["Lats", "Biceps"], difficulty: 2 },
    { name: "Cable Row", category: "back", muscles: ["Mid Back", "Lats"], difficulty: 2 },
    
    // Shoulders
    { name: "Overhead Press", category: "shoulders", muscles: ["Front Delts", "Triceps"], difficulty: 3 },
    { name: "Lateral Raises", category: "shoulders", muscles: ["Side Delts"], difficulty: 2 },
    { name: "Face Pulls", category: "shoulders", muscles: ["Rear Delts", "Traps"], difficulty: 2 },
    { name: "Arnold Press", category: "shoulders", muscles: ["All Delts"], difficulty: 3 },
    { name: "Upright Row", category: "shoulders", muscles: ["Side Delts", "Traps"], difficulty: 2 },
    
    // Arms
    { name: "Bicep Curls", category: "arms", muscles: ["Biceps"], difficulty: 1 },
    { name: "Hammer Curls", category: "arms", muscles: ["Biceps", "Forearms"], difficulty: 2 },
    { name: "Tricep Extensions", category: "arms", muscles: ["Triceps"], difficulty: 2 },
    { name: "Close-Grip Bench Press", category: "arms", muscles: ["Triceps", "Chest"], difficulty: 3 },
    { name: "Cable Curls", category: "arms", muscles: ["Biceps"], difficulty: 2 },
    
    // Legs
    { name: "Squats", category: "legs", muscles: ["Quads", "Glutes", "Hamstrings"], difficulty: 4 },
    { name: "Leg Press", category: "legs", muscles: ["Quads", "Glutes"], difficulty: 2 },
    { name: "Romanian Deadlift", category: "legs", muscles: ["Hamstrings", "Glutes"], difficulty: 3 },
    { name: "Leg Curls", category: "legs", muscles: ["Hamstrings"], difficulty: 2 },
    { name: "Calf Raises", category: "legs", muscles: ["Calves"], difficulty: 1 },
    { name: "Lunges", category: "legs", muscles: ["Quads", "Glutes"], difficulty: 3 },
    
    // Core
    { name: "Plank", category: "core", muscles: ["Abs", "Lower Back"], difficulty: 2 },
    { name: "Crunches", category: "core", muscles: ["Abs"], difficulty: 1 },
    { name: "Russian Twists", category: "core", muscles: ["Abs", "Obliques"], difficulty: 2 },
    { name: "Leg Raises", category: "core", muscles: ["Lower Abs"], difficulty: 3 },
    { name: "Cable Crunches", category: "core", muscles: ["Abs"], difficulty: 2 }
];

// Mapping of muscle categories to specific muscle groups.  These are used
// for selecting the body part an exercise or personal record hits.  When a
// category has only one entry, the sub-select will be hidden and the
// single muscle group will be used automatically.
const muscleOptions = {
    chest: ['Upper Chest', 'Lower Chest'],
    back: ['Lats', 'Mid Back', 'Lower Back', 'Traps'],
    shoulders: ['Front Delts', 'Side Delts', 'Rear Delts'],
    arms: ['Biceps', 'Triceps', 'Forearms'],
    legs: ['Quads', 'Hamstrings', 'Glutes', 'Calves'],
    core: ['Abs', 'Obliques']
};

// Holds the ID of the routine currently being edited via the routine exercise modal
let editingRoutineId = null;

// ===============================================
// Authentication Functions
// ===============================================
window.showLogin = () => {
    document.getElementById('login-tab').classList.add('active');
    document.getElementById('signup-tab').classList.remove('active');
    document.getElementById('login-form').style.display = 'block';
    document.getElementById('signup-form').style.display = 'none';
};

window.showSignup = () => {
    document.getElementById('signup-tab').classList.add('active');
    document.getElementById('login-tab').classList.remove('active');
    document.getElementById('signup-form').style.display = 'block';
    document.getElementById('login-form').style.display = 'none';
};

window.handleLogin = async () => {
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    
    if (!email || !password) {
        showNotification('Please fill in all fields', 'error');
        return;
    }
    
    try {
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        showNotification('Login successful! Welcome back!', 'success');
    } catch (error) {
        console.error('Login error:', error);
        showNotification(getErrorMessage(error.code), 'error');
    }
};

window.handleSignup = async () => {
    const name = document.getElementById('signup-name').value;
    const email = document.getElementById('signup-email').value;
    const password = document.getElementById('signup-password').value;
    
    if (!name || !email || !password) {
        showNotification('Please fill in all fields', 'error');
        return;
    }
    
    if (password.length < 6) {
        showNotification('Password must be at least 6 characters', 'error');
        return;
    }
    
    try {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;
        
        // Create user profile in Firestore
        await setDoc(doc(db, 'users', user.uid), {
            userId: user.uid,
            displayName: name,
            email: email,
            createdAt: serverTimestamp(),
            stats: {
                totalWorkouts: 0,
                totalWeight: 0,
                currentStreak: 0,
                lastWorkout: null,
                personalRecords: {}
            },
            settings: {
                units: 'lbs',
                weekStartsOn: 'sunday'
            },
            musclesWorkedThisWeek: {},
            weekResetDate: getNextSunday()
        });
        
        showNotification('Account created successfully! Welcome to GymTracker Pro!', 'success');
    } catch (error) {
        console.error('Signup error:', error);
        showNotification(getErrorMessage(error.code), 'error');
    }
};

window.handleGoogleLogin = async () => {
    const provider = new GoogleAuthProvider();
    
    try {
        const result = await signInWithPopup(auth, provider);
        const user = result.user;
        
        // Check if user profile exists
        const userDoc = await getDoc(doc(db, 'users', user.uid));
        
        if (!userDoc.exists()) {
            // Create profile for new Google users
            await setDoc(doc(db, 'users', user.uid), {
                userId: user.uid,
                displayName: user.displayName || 'Gym Warrior',
                email: user.email,
                createdAt: serverTimestamp(),
                stats: {
                    totalWorkouts: 0,
                    totalWeight: 0,
                    currentStreak: 0,
                    lastWorkout: null,
                    personalRecords: {}
                },
                settings: {
                    units: 'lbs',
                    weekStartsOn: 'sunday'
                },
                musclesWorkedThisWeek: {},
                weekResetDate: getNextSunday()
            });
        }
        
        showNotification('Google login successful!', 'success');
    } catch (error) {
        console.error('Google login error:', error);
        showNotification('Google login failed. Please try again.', 'error');
    }
};

window.handleForgotPassword = async () => {
    const email = prompt('Enter your email address:');
    
    if (!email) return;
    
    try {
        await sendPasswordResetEmail(auth, email);
        showNotification('Password reset email sent! Check your inbox.', 'success');
    } catch (error) {
        console.error('Password reset error:', error);
        showNotification(getErrorMessage(error.code), 'error');
    }
};

window.handleLogout = async () => {
    if (confirm('Are you sure you want to log out?')) {
        try {
            await firebaseSignOut(auth);
            showNotification('Logged out successfully', 'success');
        } catch (error) {
            console.error('Logout error:', error);
            showNotification('Logout failed. Please try again.', 'error');
        }
    }
};

// Auth state observer
onAuthStateChanged(auth, async (user) => {
  if (user) {
    try {
      const userRef = doc(db, "users", user.uid);
      const snap = await getDoc(userRef);

      // ✅ Fix: if doc exists but missing userId, patch it
      if (snap.exists() && !snap.data().userId) {
        await updateDoc(userRef, { userId: user.uid });
        console.log("[Fix] Added missing userId to existing profile");
      }
    } catch (e) {
      console.warn("User profile backfill check failed:", e);
    }

    currentUser = user;
    window.currentUser = user;
    await loadUserData();
    showMainDashboard();
    hideLoadingScreen();
  } else {
    currentUser = null;
    window.currentUser = null;
    showAuthScreen();
    hideLoadingScreen();
  }
});

// ===============================================
// User Data Management
// ===============================================
async function loadUserData() {
    if (!currentUser) return;
    
    try {
        const userDoc = await getDoc(doc(db, 'users', currentUser.uid));
        
        if (userDoc.exists()) {
            const userData = userDoc.data();
            
            // Update welcome message
            document.getElementById('user-name').textContent = userData.displayName || 'Champion';
            
            // Update stats summary cards
            document.getElementById('total-workouts').textContent = userData.stats?.totalWorkouts || 0;
            document.getElementById('total-weight').textContent = `${userData.stats?.totalWeight || 0} lbs`;
            document.getElementById('total-prs').textContent = Object.keys(userData.stats?.personalRecords || {}).length;

            // Update streak and PR counters on the dashboard
            updateDashboardStats(userData);
            
            // Check if week needs reset
            await checkWeeklyReset();
            
            // Load muscle map
            await loadMuscleMap();
            
            // Load workout history
            await loadWorkoutHistory();
            
            // Load routines
            await loadRoutines();
            
            // Load PRs
            await loadPRs();
            
            // Load measurements
            await loadMeasurements();

            await loadProgressPhotos();
        }
    } catch (error) {
        console.error('Error loading user data:', error);
    }
}

// ===============================================
// Weekly Reset for Muscle Map
// ===============================================
async function checkWeeklyReset() {
    if (!currentUser) return;
    
    const userRef = doc(db, 'users', currentUser.uid);
    const userDoc = await getDoc(userRef);
    
    if (userDoc.exists()) {
        const userData = userDoc.data();
        const resetDate = userData.weekResetDate?.toDate() || new Date();
        const now = new Date();
        
        if (now >= resetDate) {
            // Reset muscle map
            await updateDoc(userRef, {
                musclesWorkedThisWeek: {},
                weekResetDate: getNextSunday()
            });
            
            // Clear visual muscle map
            clearMuscleMap();
        }
    }
}

function getNextSunday() {
    const now = new Date();
    const daysUntilSunday = (7 - now.getDay()) % 7 || 7;
    const nextSunday = new Date(now);
    nextSunday.setDate(now.getDate() + daysUntilSunday);
    nextSunday.setHours(0, 0, 0, 0);
    return nextSunday;
}

// ===============================================
// UI Management Functions
// ===============================================
function hideLoadingScreen() {
    setTimeout(() => {
        const loadingScreen = document.getElementById('loading-screen');
        if (loadingScreen) {
            loadingScreen.style.display = 'none';
        }
    }, 2000);
}

function showAuthScreen() {
    document.getElementById('auth-container').style.display = 'flex';
    document.getElementById('main-dashboard').style.display = 'none';
}

function showMainDashboard() {
    document.getElementById('auth-container').style.display = 'none';
    document.getElementById('main-dashboard').style.display = 'block';
    document.getElementById('main-selection').style.display = 'block';
    document.getElementById('workout-section').style.display = 'none';
    document.getElementById('calorie-section').style.display = 'none';
    
    // Update current date
    const now = new Date();
    document.getElementById('current-date').textContent = now.toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
}

window.openWorkoutSection = () => {
    document.getElementById('main-selection').style.display = 'none';
    document.getElementById('workout-section').style.display = 'block';
    document.getElementById('calorie-section').style.display = 'none';
    loadExerciseLibrary();
};

window.openCalorieSection = () => {
    document.getElementById('main-selection').style.display = 'none';
    document.getElementById('workout-section').style.display = 'none';
    document.getElementById('calorie-section').style.display = 'block';
};

window.backToMainSelection = () => {
    document.getElementById('main-selection').style.display = 'block';
    document.getElementById('workout-section').style.display = 'none';
    document.getElementById('calorie-section').style.display = 'none';
};

// ===============================================
// Workout Tab Management
// ===============================================
window.switchWorkoutTab = (tabName) => {
    // Update tab buttons
    document.querySelectorAll('.workout-tab').forEach(tab => {
        tab.classList.remove('active');
        if (tab.dataset.tab === tabName) {
            tab.classList.add('active');
        }
    });
    
    // Update tab content
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });
    
    document.getElementById(`${tabName}-tab`).classList.add('active');
};

// ===============================================
// Muscle Map Functions
// ===============================================
async function loadMuscleMap() {
    if (!currentUser) return;
    
    try {
        const userDoc = await getDoc(doc(db, 'users', currentUser.uid));
        
        if (userDoc.exists()) {
            const musclesWorked = userDoc.data().musclesWorkedThisWeek || {};
            
            // Update visual muscle map
            Object.keys(musclesWorked).forEach(muscle => {
                if (musclesWorked[muscle]) {
                    highlightMuscle(muscle);
                }
            });
        }
    } catch (error) {
        console.error('Error loading muscle map:', error);
    }
}

function highlightMuscle(muscleName) {
    // Highlight SVG muscles
    document.querySelectorAll(`[data-muscle="${muscleName}"]`).forEach(element => {
        element.classList.add('worked');
    });
    
    // Highlight muscle list items
    document.querySelectorAll(`.muscle-item[data-muscle="${muscleName}"]`).forEach(item => {
        item.classList.add('worked');
    });
}

function clearMuscleMap() {
    document.querySelectorAll('.muscle-group').forEach(element => {
        element.classList.remove('worked');
    });
    
    document.querySelectorAll('.muscle-item').forEach(item => {
        item.classList.remove('worked');
    });
}

async function updateMusclesWorked(muscles) {
    if (!currentUser) return;
    
    const userRef = doc(db, 'users', currentUser.uid);
    const updateData = {};
    
    muscles.forEach(muscle => {
        updateData[`musclesWorkedThisWeek.${muscle}`] = true;
    });
    
    try {
        await updateDoc(userRef, updateData);
        
        // Update visual
        muscles.forEach(muscle => {
            highlightMuscle(muscle);
        });
    } catch (error) {
        console.error('Error updating muscles worked:', error);
    }
}

// ===============================================
// Workout Functions
// ===============================================
window.startWorkout = () => {
    currentWorkout = {
        startTime: new Date(),
        exercises: []
    };
    
    workoutStartTime = Date.now();
    startTimer();
    
    document.getElementById('active-workout').style.display = 'block';
    document.getElementById('exercises-list').innerHTML = '';
    
    showNotification('Workout started! Let\'s crush it! 💪', 'success');
};

function startTimer() {
    if (workoutTimer) clearInterval(workoutTimer);
    
    workoutTimer = setInterval(() => {
        const elapsed = Date.now() - workoutStartTime;
        const hours = Math.floor(elapsed / 3600000);
        const minutes = Math.floor((elapsed % 3600000) / 60000);
        const seconds = Math.floor((elapsed % 60000) / 1000);
        
        document.getElementById('workout-timer').textContent = 
            `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }, 1000);
}

// Add a new exercise.  Optionally accepts a prefilled exercise name.  When
// prefilledName is provided (e.g. when selecting an exercise from the
// exercise library), the exercise name input will be hidden and the value
// automatically set.  Without a prefilledName, the input is shown and
// cleared so that the user can type their own exercise name.
window.addExercise = (prefilledName = '') => {
    const modal = document.getElementById('exercise-modal');
    const nameInput = document.getElementById('exercise-name');
    const setsContainer = document.getElementById('sets-container');

    modal.style.display = 'flex';

    // Assign the prefilled name (if provided) and hide the input when
    // selecting from the exercise library.  Otherwise show the input and
    // clear any previous value.
    if (prefilledName) {
        nameInput.value = prefilledName;
        nameInput.style.display = 'none';
    } else {
        nameInput.value = '';
        nameInput.style.display = '';
    }
    // Reset sets container and add a default set
    setsContainer.innerHTML = '';
    addSet();

    // Reset muscle category and sub selects when opening the modal.  This
    // ensures the user is prompted to choose a muscle group each time.
    const catSelect = document.getElementById('muscle-category');
    const subSelect = document.getElementById('muscle-sub');
    if (catSelect) catSelect.value = '';
    if (subSelect) {
        subSelect.innerHTML = '<option value="">Select specific muscle</option>';
        subSelect.style.display = 'none';
        subSelect.value = '';
    }

    // If the exercise name was prefilled, automatically select the
    // appropriate muscle category and sub-group based on the
    // defaultExercises mapping.  This removes manual selection
    // steps for the user when choosing from the library.  We
    // dispatch a change event on the category select to populate
    // the sub-group options, then set the sub-group value to
    // whichever specific muscle matches the exercise’s muscles list.
    if (prefilledName) {
        const match = defaultExercises.find(ex => ex.name.toLowerCase() === prefilledName.toLowerCase());
        if (match && catSelect) {
            catSelect.value = match.category;
            // Trigger change event to populate sub options
            const evt = new Event('change');
            catSelect.dispatchEvent(evt);
            if (subSelect) {
                // Determine which specific muscle option best matches the exercise's muscles array
                const subOptions = muscleOptions[match.category] || [];
                let chosen = '';
                if (subOptions.length > 0) {
                    // Try to match the first muscle in the exercise's muscles list that appears in the sub options
                    const normalizedSubs = subOptions.map(s => s.toLowerCase());
                    for (const m of match.muscles) {
                        const idx = normalizedSubs.indexOf(m.toLowerCase());
                        if (idx !== -1) {
                            chosen = subOptions[idx];
                            break;
                        }
                    }
                    // If no match found, default to the first available sub option
                    if (!chosen) {
                        chosen = subOptions[0];
                    }
                }
                if (chosen) {
                    // If there is more than one option, show the sub-select; otherwise it remains hidden
                    if (subOptions.length > 1) {
                        subSelect.style.display = '';
                        subSelect.value = chosen;
                    } else {
                        subSelect.style.display = 'none';
                        subSelect.value = chosen;
                    }
                }
            }
        }
    }
};

window.closeExerciseModal = () => {
    const modal = document.getElementById('exercise-modal');
    if (modal) modal.style.display = 'none';
    // Always show the exercise name input again when closing the modal so
    // that subsequent manual adds are not hidden.  The value will be
    // reset when addExercise() runs.
    const nameInput = document.getElementById('exercise-name');
    if (nameInput) nameInput.style.display = '';
};

window.addSet = () => {
    const setsContainer = document.getElementById('sets-container');
    const setNumber = setsContainer.children.length + 1;
    // Each set row uses a grid with three columns: set label, a flex
    // container for weight/reps inputs, and a completion button.  The
    // inputs are wrapped in a div so they can flex evenly across the
    // available space on both desktop and mobile screens.  Using IDs
    // ensures saveExercise() can still find the values.
    const setRow = document.createElement('div');
    setRow.className = 'set-row';
    setRow.innerHTML = `
        <span class="set-number">Set ${setNumber}</span>
        <div class="set-inputs">
            <input type="number" class="set-input" placeholder="Weight" id="weight-${setNumber}">
            <input type="number" class="set-input" placeholder="Reps" id="reps-${setNumber}">
        </div>
        <button class="set-complete" onclick="toggleSetComplete(this)">✓</button>
    `;
    setsContainer.appendChild(setRow);
};

window.toggleSetComplete = (button) => {
    button.classList.toggle('completed');
};

window.saveExercise = () => {
    const exerciseName = document.getElementById('exercise-name').value;
    
    if (!exerciseName) {
        showNotification('Please enter an exercise name', 'error');
        return;
    }
    
    const sets = [];
    const setRows = document.querySelectorAll('#sets-container .set-row');
    
    setRows.forEach((row, index) => {
        const weightVal = row.querySelector(`#weight-${index + 1}`).value;
        const repsVal = row.querySelector(`#reps-${index + 1}`).value;
        const completed = row.querySelector('.set-complete').classList.contains('completed');
        // Allow empty weight or reps; default to 0 so users can fill these later in the workout
        const weightNum = weightVal ? parseFloat(weightVal) : 0;
        const repsNum = repsVal ? parseInt(repsVal) : 0;
        sets.push({ weight: weightNum, reps: repsNum, completed });
    });
    
    if (sets.length === 0) {
        showNotification('Please add at least one set', 'error');
        return;
    }
    
    // Build the exercise object.  Include a muscleGroup property based on
    // the selected category/sub-group from the modal.  We first check the
    // sub-group select (only visible when multiple choices exist).  If a
    // specific muscle is selected, use it; otherwise default to the first
    // muscle in the chosen category.  If no category was chosen, the
    // muscleGroup will be undefined and we fall back to the library data.
    const catSelect = document.getElementById('muscle-category');
    const subSelect = document.getElementById('muscle-sub');
    let muscleGroup = null;
    if (subSelect && subSelect.style.display !== 'none' && subSelect.value) {
        muscleGroup = subSelect.value;
    } else if (catSelect && catSelect.value) {
        const opts = muscleOptions[catSelect.value] || [];
        muscleGroup = subSelect && subSelect.value ? subSelect.value : (opts[0] || catSelect.value);
    }

    // Add to current workout
    // If a workout hasn't started yet, begin one now so that the
    // exercise has somewhere to live.  This defers starting the
    // timer until the user explicitly saves the first exercise.
    if (!currentWorkout) {
        startWorkout();
    }

    const exercise = {
        name: exerciseName,
        sets: sets,
        timestamp: new Date(),
        muscleGroup: muscleGroup || undefined
    };

    currentWorkout.exercises.push(exercise);

    // Update UI
    displayExercise(exercise);

    // Update the muscle map immediately based on either the selected muscle
    // group or the default exercise library.  If the user selected a
    // specific muscle, use that; otherwise use the library-defined
    // muscles.
    if (muscleGroup) {
        updateMusclesWorked(getMuscleGroups([muscleGroup]));
    } else {
        const exerciseData = defaultExercises.find(e =>
            e.name.toLowerCase() === exerciseName.toLowerCase()
        );
        if (exerciseData) {
            const musclesToUpdate = getMuscleGroups(exerciseData.muscles);
            updateMusclesWorked(musclesToUpdate);
        }
    }

    // Close the modal and restore the name input for next add
    closeExerciseModal();
    showNotification('Exercise added!', 'success');
    // After saving an exercise, switch to the workout tab so the user sees
    // their exercise in the active workout.  This also applies when
    // adding from the library.
    try {
        switchWorkoutTab('workout');
    } catch (_) {}
};

function displayExercise(exercise) {
    const exercisesList = document.getElementById('exercises-list');
    
    const exerciseItem = document.createElement('div');
    exerciseItem.className = 'exercise-item';
    // Determine the index of this exercise within the current workout for later toggles
    const exerciseIndex = currentWorkout.exercises.indexOf(exercise);
    // Calculate volume only from completed sets.  Unchecked sets are intentionally excluded.
    const totalVolume = exercise.sets
        .filter(set => set.completed)
        .reduce((sum, set) => sum + (set.weight * set.reps), 0);

    exerciseItem.innerHTML = `
        <div class="exercise-header">
            <span class="exercise-name">${exercise.name}</span>
            <span class="exercise-volume">${totalVolume} lbs</span>
        </div>
        <div class="exercise-sets">
            ${exercise.sets.map((set, index) => `
                <div class="set-row" data-exercise-index="${exerciseIndex}" data-set-index="${index}">
                    <span class="set-number">Set ${index + 1}</span>
                    <div class="set-inputs" data-exercise-index="${exerciseIndex}" data-set-index="${index}">
                        <input type="number" class="set-display-weight" data-exercise-index="${exerciseIndex}" data-set-index="${index}" value="${set.weight}" min="0">
                        <input type="number" class="set-display-reps" data-exercise-index="${exerciseIndex}" data-set-index="${index}" value="${set.reps}" min="0">
                    </div>
                    <span class="set-status ${set.completed ? 'completed' : ''}" data-exercise-index="${exerciseIndex}" data-set-index="${index}">
                        ${set.completed ? '✓' : '○'}
                    </span>
                    ${exercise.sets.length > 1 ? `
                    <button class="set-remove" data-exercise-index="${exerciseIndex}" data-set-index="${index}" title="Remove set">&minus;</button>
                    ` : `<span class="set-remove-placeholder"></span>`}
                </div>
            `).join('')}
            <button class="inline-add-set" data-exercise-index="${exerciseIndex}" title="Add Set"><i class="fas fa-plus"></i></button>
        </div>
    `;
    exercisesList.appendChild(exerciseItem);
}

window.finishWorkout = async () => {
    if (!currentWorkout || currentWorkout.exercises.length === 0) {
        showNotification('Please add at least one exercise before finishing', 'error');
        return;
    }
    
    if (!confirm('Are you ready to finish this workout?')) return;
    
    // Warn the user if there are any sets without a completion mark.
    const hasIncompleteSets = currentWorkout.exercises.some(exercise =>
        exercise.sets.some(set => !set.completed)
    );
    if (hasIncompleteSets) {
        showNotification('Some sets were left unchecked and will not be counted towards volume.', 'info');
    }

    clearInterval(workoutTimer);
    
    const endTime = new Date();
    const duration = Math.floor((endTime - currentWorkout.startTime) / 1000); // in seconds
    
    // Calculate total volume from completed sets only. Sets that remain unchecked are ignored.
    const totalVolume = currentWorkout.exercises.reduce((total, exercise) => {
        const exerciseVolume = exercise.sets
            .filter(set => set.completed)
            .reduce((sum, set) => sum + (set.weight * set.reps), 0);
        return total + exerciseVolume;
    }, 0);
    
    try {
        // Save workout to Firestore
        // Capture an optional title from the input box.  Empty titles are omitted.
        const workoutTitleInput = document.getElementById('workout-title');
        const workoutTitle = workoutTitleInput ? workoutTitleInput.value.trim() : '';

        await addDoc(collection(db, 'users', currentUser.uid, 'workouts'), {
            userId: currentUser.uid,
            startTime: Timestamp.fromDate(currentWorkout.startTime),
            endTime: Timestamp.fromDate(endTime),
            duration: duration,
            exercises: currentWorkout.exercises,
            totalVolume: totalVolume,
            title: workoutTitle || null,
            createdAt: serverTimestamp()
        });
        
        // Update user stats (works even if the profile/stats are missing)
        const userRef = doc(db, 'users', currentUser.uid);
        let snap = await getDoc(userRef);

        // If the user doc doesn't exist yet, seed it with defaults
        if (!snap.exists()) {
        await setDoc(userRef, {
            userId: currentUser.uid,
            createdAt: serverTimestamp(),
            stats: {
            totalWorkouts: 0,
            totalWeight: 0,
            currentStreak: 0,
            lastWorkout: null,
            personalRecords: {}
            }
        }, { merge: true });
        snap = await getDoc(userRef);
        }

        // Safely read current stats
        const data = snap.exists() ? snap.data() : {};
        const currentStats = data?.stats ?? { totalWorkouts: 0, totalWeight: 0 };

        // Compute new streak: maintain the streak on the same day, increment
        // it if the last workout was yesterday, otherwise reset to 1.
        let newStreak = 1;
        try {
            const lastWorkoutTS = currentStats?.lastWorkout;
            if (lastWorkoutTS?.toDate) {
                const lastDate = lastWorkoutTS.toDate();
                const nowDate = new Date();
                const diffDays = Math.floor((nowDate - lastDate) / (24 * 60 * 60 * 1000));
                if (diffDays === 0) {
                    // Same day: keep the current streak
                    newStreak = currentStats.currentStreak || 1;
                } else if (diffDays === 1) {
                    // Consecutive day: increment streak
                    newStreak = (currentStats.currentStreak || 0) + 1;
                } else {
                    // Break in streak: start new streak at 1
                    newStreak = 1;
                }
            }
        } catch (_) {
            newStreak = 1;
        }
        await updateDoc(userRef, {
        'stats.totalWorkouts': (currentStats.totalWorkouts ?? 0) + 1,
        'stats.totalWeight': (currentStats.totalWeight ?? 0) + totalVolume,
        'stats.currentStreak': newStreak,
        'stats.lastWorkout': serverTimestamp()
        });
        
        // Reset workout UI
        document.getElementById('active-workout').style.display = 'none';
        document.getElementById('workout-timer').textContent = '00:00:00';
        // Clear workout title field if present
        const titleInput = document.getElementById('workout-title');
        if (titleInput) titleInput.value = '';
        currentWorkout = null;
        
        // Reload workout history
        await loadWorkoutHistory();
        await loadUserData();
        
        showNotification('Great workout! Keep up the amazing work! 🔥', 'success');
    } catch (error) {
        console.error('Error saving workout:', error);
        showNotification('Error saving workout. Please try again.', 'error');
    }
};

window.cancelWorkout = () => {
    if (!confirm('Are you sure you want to cancel this workout? All data will be lost.')) return;
    
    clearInterval(workoutTimer);
    document.getElementById('active-workout').style.display = 'none';
    document.getElementById('workout-timer').textContent = '00:00:00';
    // Clear workout title field if present
    const titleInput = document.getElementById('workout-title');
    if (titleInput) titleInput.value = '';
    currentWorkout = null;
    
    showNotification('Workout cancelled', 'info');
};

// ===============================================
// Workout History
// ===============================================
async function loadWorkoutHistory() {
    if (!currentUser) return;
    
    try {
        const workoutsRef = collection(db, 'users', currentUser.uid, 'workouts');
        const q = query(workoutsRef, orderBy('createdAt', 'desc'), qLimit(10));
        const querySnapshot = await getDocs(q);
        
        const historyList = document.getElementById('history-list');
        historyList.innerHTML = '';
        
        if (querySnapshot.empty) {
            historyList.innerHTML = '<p style="color: rgba(255,255,255,0.5);">No workouts yet. Start your first workout!</p>';
            return;
        }
        
        querySnapshot.forEach((docSnap) => {
            const workout = docSnap.data();
            const docId = docSnap.id;
            const date = workout.startTime.toDate();
            // Use the workout title if present; otherwise display the exercise names
            let displayName = workout.title;
            if (!displayName || displayName.trim() === '') {
                displayName = workout.exercises.map(e => e.name).join(', ');
            }
            const historyItem = document.createElement('div');
            historyItem.className = 'history-item';
            historyItem.innerHTML = `
                <div class="history-date">${date.toLocaleDateString()} - ${date.toLocaleTimeString()}</div>
                <div class="history-exercises">${displayName}</div>
                <div class="history-stats">
                    <span>Duration: ${formatDuration(workout.duration)}</span>
                    <span>Volume: ${workout.totalVolume} lbs</span>
                </div>
            `;
            // Add delete button for this workout
            const delBtn = document.createElement('button');
            delBtn.className = 'history-delete';
            delBtn.innerHTML = '&times;';
            delBtn.title = 'Delete workout';
            delBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                deleteWorkout(docId);
            });
            historyItem.appendChild(delBtn);
            historyList.appendChild(historyItem);
        });
    } catch (error) {
        console.error('Error loading workout history:', error);
    }
}

// ===============================================
// Routines Management
// ===============================================
window.showRoutines = () => {
    document.getElementById('routines-modal').style.display = 'flex';
    displayRoutines();
};

window.closeRoutinesModal = () => {
    document.getElementById('routines-modal').style.display = 'none';
};

window.createRoutine = async () => {
    const routineName = prompt('Enter routine name:');
    if (!routineName) return;
    
    const routine = {
        userId: currentUser.uid,
        name: routineName,
        exercises: [],
        createdAt: serverTimestamp()
    };
    
    try {
        await addDoc(collection(db, 'users', currentUser.uid, 'routines'), routine);
        await loadRoutines();
        showNotification('Routine created! Add exercises to it from your workouts.', 'success');
    } catch (error) {
        console.error('Error creating routine:', error);
        showNotification('Error creating routine', 'error');
    }
};

async function loadRoutines() {
    if (!currentUser) return;
    
    try {
        const routinesRef = collection(db, 'users', currentUser.uid, 'routines');
        const querySnapshot = await getDocs(routinesRef);
        
        userRoutines = [];
        querySnapshot.forEach((doc) => {
            userRoutines.push({ id: doc.id, ...doc.data() });
        });
        
        displayRoutines();
    } catch (error) {
        console.error('Error loading routines:', error);
    }
}

function displayRoutines() {
    const routinesList = document.getElementById('routines-list');
    routinesList.innerHTML = '';
    
    if (userRoutines.length === 0) {
        routinesList.innerHTML = '<p style="color: rgba(255,255,255,0.5);">No routines yet. Create your first routine!</p>';
        return;
    }
    
    userRoutines.forEach(routine => {
        const routineItem = document.createElement('div');
        routineItem.className = 'routine-item';
        // The routine item contains the name, exercise count and an edit button.  Clicking the name starts a workout.
        routineItem.innerHTML = `
            <div class="routine-info" style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
              <div class="routine-name" style="flex:1; cursor:pointer;">${routine.name}</div>
              <div class="routine-exercises" style="white-space:nowrap;">${routine.exercises.length} exercises</div>
              <button class="edit-routine-btn" data-routine-id="${routine.id}" title="Edit routine"><i class="fas fa-edit"></i></button>
            </div>
        `;
        // Start the workout when the routine name or exercises count is clicked
        routineItem.querySelector('.routine-name').addEventListener('click', () => startRoutineWorkout(routine));
        routineItem.querySelector('.routine-exercises').addEventListener('click', () => startRoutineWorkout(routine));
        // Bind edit button
        const editBtn = routineItem.querySelector('.edit-routine-btn');
        editBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            editRoutine(routine.id);
        });
        routinesList.appendChild(routineItem);
    });
}

function startRoutineWorkout(routine) {
    closeRoutinesModal();
    startWorkout();
    
    // Pre-populate with routine exercises
    routine.exercises.forEach(exercise => {
        // Copy sets; ensure each set has a completed field reset to false
        const sets = Array.isArray(exercise.sets)
            ? exercise.sets.map(set => ({ ...set, completed: false }))
            : [];
        const newExercise = {
            name: exercise.name,
            sets: sets,
            timestamp: new Date()
        };
        currentWorkout.exercises.push(newExercise);
        displayExercise(newExercise);
        // If the exercise has a muscleGroup property, update muscles worked immediately
        if (exercise.muscleGroup) {
            updateMusclesWorked(getMuscleGroups([exercise.muscleGroup]));
        }
    });

    showNotification(`Started workout with ${routine.name} routine`, 'success');
}

// Delete the currently editing routine.  This can be triggered from the
// routine exercise modal.  Confirm with the user before deletion and
// reload routines afterwards.
window.deleteRoutine = async () => {
    try {
        if (!currentUser || !editingRoutineId) {
            showNotification('No routine selected to delete.', 'error');
            return;
        }
        if (!confirm('Are you sure you want to delete this routine?')) return;
        await deleteDoc(doc(db, 'users', currentUser.uid, 'routines', editingRoutineId));
        editingRoutineId = null;
        closeRoutineExerciseModal();
        await loadRoutines();
        showNotification('Routine deleted.', 'success');
    } catch (err) {
        console.error('Error deleting routine:', err);
        showNotification('Failed to delete routine.', 'error');
    }
};

// Delete a workout from the user's workout history by document ID.  After
// deletion, reload the workout history and user stats.  A confirmation
// dialog prevents accidental removals.
window.deleteWorkout = async (workoutId) => {
    try {
        if (!currentUser || !workoutId) return;
        if (!confirm('Delete this workout?')) return;
        await deleteDoc(doc(db, 'users', currentUser.uid, 'workouts', workoutId));
        await loadWorkoutHistory();
        // Refresh overall stats and streaks
        await loadUserData();
        showNotification('Workout deleted.', 'success');
    } catch (err) {
        console.error('Error deleting workout:', err);
        showNotification('Failed to delete workout.', 'error');
    }
};

// Allow the user to edit a routine by adding custom exercises.  For simplicity
// this implementation prompts the user for the exercise name, the body part hit
// and the number of sets.  New exercises are appended to the routine.  If you
// need more advanced editing (e.g. removing exercises), you can extend this
// helper accordingly.
window.editRoutine = async (routineId) => {
    // Open a modal for editing this routine.  Store the routine ID for
    // reference when saving.  The actual edits are performed in
    // saveRoutineExercise().
    editingRoutineId = routineId;
    openRoutineExerciseModal();
};

// --------------------------------------------------------------
// Routine Exercise Modal Helpers
//
// These functions control the modal used for adding or editing
// exercises within a routine.  They avoid reliance on browser
// prompts, instead presenting a consistent UI with drop-downs for
// selecting the target muscle group and number of sets.  An
// optional global variable `editingRoutineId` indicates which
// routine is being modified.

// Show the routine exercise modal and clear previous input.  If
// editingRoutineId is not set, the modal will still open but
// saving will have no effect.
window.openRoutineExerciseModal = () => {
    const modal = document.getElementById('routine-exercise-modal');
    if (!modal) return;
    // Clear form fields
    const nameInput = document.getElementById('routine-exercise-name');
    if (nameInput) nameInput.value = '';
    const catSelect = document.getElementById('routine-muscle-category');
    const subSelect = document.getElementById('routine-muscle-sub');
    const setsInput = document.getElementById('routine-sets-count');
    if (catSelect) catSelect.value = '';
    if (subSelect) {
        subSelect.innerHTML = '<option value="">Select specific muscle</option>';
        subSelect.style.display = 'none';
    }
    if (setsInput) setsInput.value = '';
    // Show or hide the delete button based on whether a routine is being edited.
    const delBtn = document.querySelector('#routine-exercise-modal .delete-routine-btn');
    if (delBtn) {
        delBtn.style.display = editingRoutineId ? '' : 'none';
    }
    modal.style.display = 'flex';
};

// Close the routine exercise modal
window.closeRoutineExerciseModal = () => {
    const modal = document.getElementById('routine-exercise-modal');
    if (modal) modal.style.display = 'none';
};

// Save a new exercise to the currently editing routine.  This will
// append the exercise to the routine's existing list of exercises in
// Firestore, along with a selected muscle group and default sets.
window.saveRoutineExercise = async () => {
    try {
        if (!currentUser || !editingRoutineId) {
            showNotification('No routine selected for editing.', 'error');
            return;
        }
        const nameInput = document.getElementById('routine-exercise-name');
        const catSelect = document.getElementById('routine-muscle-category');
        const subSelect = document.getElementById('routine-muscle-sub');
        const setsInput = document.getElementById('routine-sets-count');

        const exerciseName = (nameInput && nameInput.value.trim()) || '';
        if (!exerciseName) {
            showNotification('Please enter a name for the exercise.', 'error');
            return;
        }
        const category = catSelect ? catSelect.value : '';
        const sub = subSelect ? subSelect.value : '';
        // Determine the muscle group: prefer sub-group if provided,
        // otherwise use the category itself.  This allows one-option
        // categories (e.g. arms) to skip the sub-select entirely.
        let muscleGroup = '';
        if (sub && sub.trim()) {
            muscleGroup = sub.trim();
        } else if (category) {
            // Use title-case for consistency
            muscleGroup = category.charAt(0).toUpperCase() + category.slice(1);
        }
        // Determine number of sets; default to 3 if blank or invalid
        let numSets = parseInt(setsInput && setsInput.value);
        if (isNaN(numSets) || numSets <= 0) numSets = 3;
        // Build default sets array
        const sets = [];
        for (let i = 0; i < numSets; i++) {
            sets.push({ weight: 0, reps: 0, completed: false });
        }
        // Fetch the routine doc and append the exercise
        const routineRef = doc(db, 'users', currentUser.uid, 'routines', editingRoutineId);
        const routineSnap = await getDoc(routineRef);
        if (!routineSnap.exists()) {
            showNotification('Routine not found.', 'error');
            return;
        }
        const routineData = routineSnap.data() || {};
        const exercises = Array.isArray(routineData.exercises) ? routineData.exercises.slice() : [];
        exercises.push({ name: exerciseName, sets, muscleGroup });
        await updateDoc(routineRef, { exercises });
        showNotification('Exercise added to routine!', 'success');
        // Refresh routines list
        await loadRoutines();
        // Close the modal
        closeRoutineExerciseModal();
    } catch (err) {
        console.error('Error saving routine exercise:', err);
        showNotification('Error saving exercise to routine.', 'error');
    }
};

// ===============================================
// Progress Tab Functions
// ===============================================
// Show the PR modal instead of using prompts
window.addPR = () => {
    openPrModal();
};

// Open the personal record modal and reset fields/selects
window.openPrModal = () => {
    const modal = document.getElementById('pr-modal');
    if (!modal) return;
    modal.style.display = 'flex';
    // Reset inputs
    const exInput = document.getElementById('pr-exercise');
    const wtInput = document.getElementById('pr-weight');
    const repsInput = document.getElementById('pr-reps');
    if (exInput) exInput.value = '';
    if (wtInput) wtInput.value = '';
    if (repsInput) repsInput.value = '';
    // Reset selects
    const catSelect = document.getElementById('pr-muscle-category');
    const subSelect = document.getElementById('pr-muscle-sub');
    if (catSelect) catSelect.value = '';
    if (subSelect) {
        subSelect.innerHTML = '<option value="">Select specific muscle</option>';
        subSelect.style.display = 'none';
        subSelect.value = '';
    }
};

// Close the PR modal
window.closePrModal = () => {
    const modal = document.getElementById('pr-modal');
    if (modal) modal.style.display = 'none';
};

// Save PR from modal inputs.  This mirrors the previous prompt-based logic but
// uses the selected muscle group from the drop-down.
window.savePR = async () => {
    const exerciseName = document.getElementById('pr-exercise')?.value;
    const weightVal = document.getElementById('pr-weight')?.value;
    const repsVal = document.getElementById('pr-reps')?.value;
    if (!exerciseName) {
        showNotification('Please enter an exercise name', 'error');
        return;
    }
    const weight = weightVal ? parseFloat(weightVal) : null;
    const reps = repsVal ? parseInt(repsVal) : null;
    if (weight === null || isNaN(weight) || reps === null || isNaN(reps)) {
        showNotification('Please enter valid weight and reps', 'error');
        return;
    }
    // Determine muscle group from selects
    const catSelect = document.getElementById('pr-muscle-category');
    const subSelect = document.getElementById('pr-muscle-sub');
    let muscleGroup = null;
    if (subSelect && subSelect.style.display !== 'none' && subSelect.value) {
        muscleGroup = subSelect.value;
    } else if (catSelect && catSelect.value) {
        const opts = muscleOptions[catSelect.value] || [];
        muscleGroup = subSelect && subSelect.value ? subSelect.value : (opts[0] || catSelect.value);
    }
    try {
        const userRef = doc(db, 'users', currentUser.uid);
        await updateDoc(userRef, {
            [`stats.personalRecords.${exerciseName}`]: {
                weight: weight,
                reps: reps,
                muscleGroup: muscleGroup || null,
                date: serverTimestamp()
            }
        });
        // Immediately reflect the muscle worked if specified
        if (muscleGroup) {
            updateMusclesWorked(getMuscleGroups([muscleGroup]));
        }
        await loadPRs();
        // Refresh user data to update streak and PR counters
        await loadUserData();
        showNotification('Personal Record added! 🏆', 'success');
        closePrModal();
    } catch (error) {
        console.error('Error adding PR:', error);
        showNotification('Error adding PR', 'error');
    }
};

async function loadPRs() {
    if (!currentUser) return;
    
    try {
        const userDoc = await getDoc(doc(db, 'users', currentUser.uid));
        const prs = userDoc.data()?.stats?.personalRecords || {};
        
        const prsList = document.getElementById('prs-list');
        prsList.innerHTML = '';
        
        if (Object.keys(prs).length === 0) {
            prsList.innerHTML = '<p style="color: rgba(255,255,255,0.5);">No personal records yet. Set your first PR!</p>';
            return;
        }
        
        Object.entries(prs).forEach(([exercise, record]) => {
            const prItem = document.createElement('div');
            prItem.className = 'pr-item';
            // Click on the item (but not the delete button) to edit this PR
            prItem.addEventListener('click', (e) => {
                // Prevent click if the delete button was clicked
                if (e.target.closest('.pr-delete')) return;
                editPR(exercise, record);
            });
            // Delete button
            const delBtn = document.createElement('button');
            delBtn.className = 'pr-delete';
            delBtn.innerHTML = '&times;';
            delBtn.title = 'Delete PR';
            delBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                deletePR(exercise);
            });
            prItem.innerHTML = `
                <div class="pr-exercise">${exercise}</div>
                <div class="pr-value">${record.weight} lbs × ${record.reps}</div>
                <div class="pr-date">${record.date?.toDate ? record.date.toDate().toLocaleDateString() : 'Recent'}</div>
            `;
            prItem.appendChild(delBtn);
            prsList.appendChild(prItem);
        });
    } catch (error) {
        console.error('Error loading PRs:', error);
    }
}

// Delete a personal record for the given exercise.  This removes the
// exercise key from the user's stats.personalRecords object in
// Firestore using deleteField().
window.deletePR = async (exerciseName) => {
    try {
        if (!currentUser || !exerciseName) return;
        if (!confirm(`Delete the personal record for ${exerciseName}?`)) return;
        const userRef = doc(db, 'users', currentUser.uid);
        // Use deleteField() to remove the nested key
        await updateDoc(userRef, {
            [`stats.personalRecords.${exerciseName}`]: deleteField()
        });
        await loadPRs();
        // Refresh user data to update counters
        await loadUserData();
        showNotification('PR deleted.', 'success');
    } catch (err) {
        console.error('Error deleting PR:', err);
        showNotification('Failed to delete PR.', 'error');
    }
};

// Edit an existing personal record.  Opens the PR modal with
// prefilled values for the selected exercise.  Users can update
// weight, reps, and muscle group and save via savePR().
window.editPR = (exerciseName, record) => {
    // Prefill the modal inputs
    try {
        openPrModal();
        const exInput = document.getElementById('pr-exercise');
        const wtInput = document.getElementById('pr-weight');
        const repsInput = document.getElementById('pr-reps');
        const catSelect = document.getElementById('pr-muscle-category');
        const subSelect = document.getElementById('pr-muscle-sub');
        if (exInput) {
            exInput.value = exerciseName;
        }
        if (wtInput) wtInput.value = record?.weight || '';
        if (repsInput) repsInput.value = record?.reps || '';
        // Set muscle group selects based on record.muscleGroup
        if (record?.muscleGroup) {
            // Find category that contains this muscle group
            let foundCat = '';
            for (const [cat, subs] of Object.entries(muscleOptions)) {
                if (subs.map(s => s.toLowerCase()).includes(record.muscleGroup.toLowerCase())) {
                    foundCat = cat;
                    break;
                }
            }
            if (foundCat) {
                catSelect.value = foundCat;
                // Trigger change event to populate subs
                const evt = new Event('change');
                catSelect.dispatchEvent(evt);
                // Try to select the exact muscle group if available
                const opts = muscleOptions[foundCat] || [];
                if (opts.includes(record.muscleGroup)) {
                    if (opts.length > 1) {
                        subSelect.style.display = '';
                        subSelect.value = record.muscleGroup;
                    } else {
                        subSelect.style.display = 'none';
                        subSelect.value = record.muscleGroup;
                    }
                }
            }
        }
    } catch (err) {
        console.error('Error editing PR:', err);
    }
};

// Photo Progress
window.addProgressPhoto = () => choosePhotoSource();

// Show a tiny menu to choose Camera vs Library
window.choosePhotoSource = () => {
  const menu = document.getElementById('photo-source-menu');
  // If the menu doesn't exist (older HTML), fall back to library chooser
  if (!menu) {
    const lib = document.getElementById('photo-input-library') || document.getElementById('photo-input');
    return lib ? lib.click() : null;
  }
  // Toggle open
  menu.style.display = 'block';

  // Click outside to close
  const closeOnOutside = (ev) => {
    if (!menu.contains(ev.target)) {
      menu.style.display = 'none';
      document.removeEventListener('click', closeOnOutside);
    }
  };
  setTimeout(() => document.addEventListener('click', closeOnOutside), 0);
};

window.openCamera = () => {
  const menu = document.getElementById('photo-source-menu');
  if (menu) menu.style.display = 'none';
  const cam = document.getElementById('photo-input-camera');
  if (cam) cam.click();
};

window.openLibrary = () => {
  const menu = document.getElementById('photo-source-menu');
  if (menu) menu.style.display = 'none';
  const lib = document.getElementById('photo-input-library');
  if (lib) lib.click();
};

// Simple, reliable upload + preview using getDownloadURL
window.handlePhotoUpload = async function handlePhotoUpload(evt) {
  try {
    const input = evt?.target || evt?.currentTarget || null;
    const file = input?.files ? input.files[0] : null;
    if (!file) {
      console.warn("[UPLOAD] No file selected");
      return;
    }
    if (!auth.currentUser) {
      console.warn("[UPLOAD] no auth user");
      return;
    }

    // basic validation
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif'];
    if (!allowed.includes(file.type)) {
      showNotification('Only image files are allowed (jpg, png, webp, gif, heic).', 'error');
      return;
    }
    const MAX_MB = 20;
    if (file.size > MAX_MB * 1024 * 1024) {
      showNotification(`Image too large. Max ${MAX_MB} MB.`, 'error');
      return;
    }

    console.log("[UPLOAD] authed?", !!auth.currentUser, "uid:", auth.currentUser?.uid);
    const userId = auth.currentUser.uid;

    // Build a safe file name and full path
    const original = file.name || 'photo';
    const safeBase = original.replace(/[^\w.\-]+/g, '_').toLowerCase();
    const fileName = `${Date.now()}_${safeBase}`;
    const filePath = `users/${userId}/progress/${fileName}`;
    console.log("[UPLOAD] type:", file.type, "size:", file.size, "path:", filePath);

    const fileRef = ref(storage, filePath);

    // IMPORTANT: include metadata so Storage rules that check contentType pass
    const metadata = {
      contentType: file.type,
      cacheControl: 'public,max-age=3600'
    };

    // Upload and then get a download URL
    const snapshot = await uploadBytes(fileRef, file, metadata);
    console.log("[UPLOAD] success:", filePath);
    const url = await getDownloadURL(snapshot.ref);

// Optimistic preview while Firestore write completes
    {
    const container = document.getElementById('progress-photos');
    if (container) {
        const img = document.createElement('img');
        img.src = url;
        img.alt = file.name || 'Progress photo';
        img.className = 'progress-photo';
        container.prepend(img);
    }
    }
    // Save metadata to Firestore
    const photosRef = collection(db, `users/${userId}/progressPhotos`);
    await addDoc(photosRef, {
      name: original,
      path: filePath,
      url,
      createdAt: Timestamp.now()
    });

    // Enforce max 20 photos (keeps the most recent 20)
    const qSnap = await getDocs(query(photosRef, orderBy("createdAt", "desc")));
    if (qSnap.size > 20) {
      const excess = qSnap.docs.slice(20);
      for (const d of excess) {
        try { await deleteDoc(d.ref); } catch (_) {}
      }
    }

    // Refresh UI
    await loadProgressPhotos();
    showNotification('Photo uploaded successfully!', 'success');
  } catch (err) {
    console.warn("[UPLOAD] storage error:", err?.code, err?.message);
    showNotification('Upload failed. Check your connection and try again.', 'error');
  }
};

async function loadProgressPhotos() {
  if (!auth.currentUser) return;
  const userId = auth.currentUser.uid;
  const photosRef = collection(db, `users/${userId}/progressPhotos`);
  const qSnap = await getDocs(query(photosRef, orderBy('createdAt', 'desc')));

  const container = document.getElementById('progress-photos');
  if (!container) return;
  container.innerHTML = '';

    for (const d of qSnap.docs) {
    const data = d.data() || {};
    // NOTE: getDownloadURL() will fail with "storage/unauthorized" if Storage rules reject reads or App Check enforcement is ON without a valid token.
    let url = await resolveStorageURL(data.url || data.path);

    // Backfill the doc with the resolved URL for faster next loads
    if (url && url !== data.url) {
      try { await updateDoc(d.ref, { url }); } catch (_) {}
    }

    // Only render if we have a valid HTTPS URL. Never fall back to a raw Storage path.
    if (!url || !/^https?:\/\//i.test(url)) {
      console.warn('[photos] skipping render; unresolved URL for', data.path || data.url);
      continue;
    }
    const img = document.createElement('img');
    img.src = url;
    img.alt = data.name || 'Progress photo';
    img.className = 'progress-photo';
    // Attach metadata to the image element for deletion.  Use
    // explicit attributes so they can be reliably read later.
    img.dataset.docId = d.id;
    img.dataset.storagePath = data.path || '';
    // When the user clicks on an image, offer to delete it.  Upon
    // confirmation, the image will be removed from both Firebase
    // Storage (if possible) and Firestore, and also removed from the
    // DOM immediately so the user sees it disappear.
    img.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      const confirmDelete = confirm('Delete this progress photo?');
      if (!confirmDelete) return;
      const docId = img.dataset.docId;
      const storagePath = img.dataset.storagePath;
      try {
        await deleteProgressPhoto(docId, storagePath);
      } finally {
        // Remove the element from the DOM regardless of errors
        img.remove();
      }
    });
    container.appendChild(img);
  }
}

// Delete a progress photo given its Firestore document ID and Storage path.
// This helper removes the image file from Firebase Storage and deletes
// the corresponding Firestore document.  After deletion it refreshes
// the progress photo list.
async function deleteProgressPhoto(docId, storagePath) {
  try {
    const userId = auth.currentUser?.uid;
    if (!userId) {
      showNotification('Please log in to delete photos.', 'error');
      return;
    }
    if (!docId) {
      console.warn('Missing docId for deleteProgressPhoto');
      return;
    }
    // Delete the Storage object if we have a path
    if (storagePath) {
      try {
        const fileRef = ref(storage, storagePath);
        await deleteObject(fileRef);
      } catch (err) {
        console.warn('Failed to delete storage object:', err?.message || err);
      }
    }
    // Delete the Firestore document
    try {
      const photoRef = doc(db, `users/${userId}/progressPhotos/${docId}`);
      await deleteDoc(photoRef);
    } catch (err) {
      console.warn('Failed to delete Firestore photo document:', err?.message || err);
    }
    // Refresh the UI
    await loadProgressPhotos();
    showNotification('Photo deleted.', 'success');
  } catch (err) {
    console.error('Error deleting progress photo:', err);
    showNotification('Failed to delete photo.', 'error');
  }
}

// Measurements
window.saveMeasurements = async () => {
    const measurements = {
        weight: parseFloat(document.getElementById('weight-input').value) || null,
        chest: parseFloat(document.getElementById('chest-input').value) || null,
        waist: parseFloat(document.getElementById('waist-input').value) || null,
        arms: parseFloat(document.getElementById('arms-input').value) || null,
        thighs: parseFloat(document.getElementById('thighs-input').value) || null,
        calves: parseFloat(document.getElementById('calves-input').value) || null,
        date: serverTimestamp()
    };
    
    // Check if at least one measurement is provided
    const hasData = Object.values(measurements).some(val => val !== null && val !== undefined);
    
    if (!hasData) {
        showNotification('Please enter at least one measurement', 'error');
        return;
    }
    
    try {
        await addDoc(collection(db, 'users', currentUser.uid, 'measurements'), { userId: currentUser.uid, ...measurements });
        
        // Clear inputs
        document.querySelectorAll('.measurement-item input').forEach(input => {
            input.value = '';
        });
        
        await loadMeasurements();
        showNotification('Measurements saved!', 'success');
    } catch (error) {
        console.error('Error saving measurements:', error);
        showNotification('Error saving measurements', 'error');
    }
};

async function loadMeasurements() {
    if (!currentUser) return;
    
    try {
        const measurementsRef = collection(db, 'users', currentUser.uid, 'measurements');
        const q = query(measurementsRef, orderBy('date', 'desc'), qLimit(1));
        const querySnapshot = await getDocs(q);
        
        if (!querySnapshot.empty) {
            const latest = querySnapshot.docs[0].data();
            
            // Display latest measurements as placeholders
            if (latest.weight) document.getElementById('weight-input').placeholder = `${latest.weight} lbs (last)`;
            if (latest.chest) document.getElementById('chest-input').placeholder = `${latest.chest}" (last)`;
            if (latest.waist) document.getElementById('waist-input').placeholder = `${latest.waist}" (last)`;
            if (latest.arms) document.getElementById('arms-input').placeholder = `${latest.arms}" (last)`;
            if (latest.thighs) document.getElementById('thighs-input').placeholder = `${latest.thighs}" (last)`;
            if (latest.calves) document.getElementById('calves-input').placeholder = `${latest.calves}" (last)`;
        }
        
        // Populate the measurements history.  Fetch up to the last 20
        // measurement entries ordered by date descending and display
        // them in a simple table.  This gives users insight into
        // their progress over time without requiring an external
        // charting library.
        {
            const histSnap = await getDocs(query(measurementsRef, orderBy('date', 'desc'), qLimit(20)));
            const rows = [];
            histSnap.forEach((d) => {
                const m = d.data() || {};
                const dt = m.date && m.date.toDate ? m.date.toDate() : null;
                const formatted = dt ? dt.toLocaleDateString() : '';
                rows.push({
                    date: formatted,
                    weight: m.weight != null ? m.weight : 'N/A',
                    chest: m.chest != null ? m.chest : 'N/A',
                    waist: m.waist != null ? m.waist : 'N/A',
                    arms: m.arms != null ? m.arms : 'N/A',
                    thighs: m.thighs != null ? m.thighs : 'N/A',
                    calves: m.calves != null ? m.calves : 'N/A'
                });
            });
            const container = document.getElementById('measurements-chart');
            if (container) {
                if (rows.length === 0) {
                    container.innerHTML = '<p>No measurements recorded yet.</p>';
                } else {
                    let tableHtml = '<table class="measurements-table"><thead><tr><th>Date</th><th>Weight (lbs)</th><th>Chest"</th><th>Waist"</th><th>Arms"</th><th>Thighs"</th><th>Calves"</th></tr></thead><tbody>';
                    rows.forEach(row => {
                        tableHtml += `<tr><td>${row.date}</td><td>${row.weight}</td><td>${row.chest}</td><td>${row.waist}</td><td>${row.arms}</td><td>${row.thighs}</td><td>${row.calves}</td></tr>`;
                    });
                    tableHtml += '</tbody></table>';
                    container.innerHTML = tableHtml;
                }
            }
        }
    } catch (error) {
        console.error('Error loading measurements:', error);
    }

    // After loading measurement history, update the weight chart with the
    // current range.  This ensures the weight graph stays in sync with
    // any new measurement data.  Note: loadWeightChart is defined
    // below and will be a no-op if the user is not logged in.
    try {
        await loadWeightChart(currentWeightRange);
    } catch (err) {
        console.warn('Failed to load weight chart:', err?.message || err);
    }
}

// ===============================================
// Weight Progress Tracking
//
// Users can log individual weight entries in addition to body
// measurements.  These weight entries are stored in the same
// measurements subcollection with all other measurement fields left
// null.  The weight progress chart visualizes these entries over
// selectable time ranges.

// Save a weight-only entry.  If the input is empty or not a positive
// number, the user is notified.  After saving, the chart reloads.
window.saveWeight = async () => {
    if (!currentUser) {
        showNotification('Please sign in to save weight entries', 'error');
        return;
    }
    const weightInput = document.getElementById('weight-only-input');
    const val = parseFloat(weightInput.value);
    if (!val || val <= 0) {
        showNotification('Please enter a valid weight', 'error');
        return;
    }
    try {
        await addDoc(collection(db, 'users', currentUser.uid, 'measurements'), {
            userId: currentUser.uid,
            weight: val,
            chest: null,
            waist: null,
            arms: null,
            thighs: null,
            calves: null,
            date: serverTimestamp()
        });
        weightInput.value = '';
        await loadWeightChart(currentWeightRange);
        showNotification('Weight saved!', 'success');
    } catch (err) {
        console.error('Error saving weight:', err);
        showNotification('Error saving weight', 'error');
    }
};

// Load weight data and render the chart for the specified range in days.
async function loadWeightChart(rangeDays = 30) {
    if (!currentUser) return;
    try {
        currentWeightRange = rangeDays;
        const measurementsRef = collection(db, 'users', currentUser.uid, 'measurements');
        const now = new Date();
        const startDate = new Date(now.getTime() - rangeDays * 24 * 60 * 60 * 1000);
        // Query for measurements with date >= startDate, ordered by date ascending
        let q; 
        if (startDate) {
            q = query(measurementsRef, where('date', '>=', Timestamp.fromDate(startDate)), orderBy('date', 'asc'));
        } else {
            q = query(measurementsRef, orderBy('date', 'asc'));
        }
        const snap = await getDocs(q);
        const labels = [];
        const data = [];
        snap.forEach(docSnap => {
            const d = docSnap.data();
            if (d.weight != null) {
                const dt = d.date && d.date.toDate ? d.date.toDate() : null;
                if (dt) {
                    labels.push(dt.toLocaleDateString());
                    data.push(d.weight);
                }
            }
        });
        // If no data points, clear chart and exit
        const canvas = document.getElementById('weight-chart');
        if (!canvas) return;
        if (labels.length === 0) {
            if (weightChart) {
                weightChart.destroy();
                weightChart = null;
            }
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            return;
        }
        // Destroy previous chart instance if exists
        if (weightChart) weightChart.destroy();
        const ctx = canvas.getContext('2d');
        // Chart may be attached to the window object when loaded via
        // external script.  Access it via window.Chart to avoid
        // undefined references inside ESM modules.
        const ChartClass = window.Chart || Chart;
        weightChart = new ChartClass(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Weight (lbs)',
                    data: data,
                    borderColor: '#d81b60',
                    backgroundColor: 'rgba(216,27,96,0.2)',
                    tension: 0.3,
                    fill: true,
                    pointRadius: 4,
                    pointHoverRadius: 6
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: {
                        title: {
                            display: true,
                            text: 'Date',
                            color: '#ccc'
                        },
                        ticks: {
                            color: '#fff'
                        }
                    },
                    y: {
                        title: {
                            display: true,
                            text: 'Weight (lbs)',
                            color: '#ccc'
                        },
                        ticks: {
                            color: '#fff'
                        },
                        beginAtZero: true
                    }
                },
                plugins: {
                    legend: {
                        labels: {
                            color: '#fff'
                        }
                    }
                }
            }
        });
        // Highlight the active range button
        document.querySelectorAll('.weight-range-btn').forEach(btn => {
            btn.classList.remove('active');
            const days = parseInt(btn.getAttribute('data-range'));
            if (days === rangeDays) {
                btn.classList.add('active');
            }
        });
    } catch (err) {
        console.error('Error loading weight chart:', err);
    }
}

// Update chart when a range button is clicked
window.updateWeightChartRange = async (days) => {
    await loadWeightChart(days);
};

// ===============================================
// Exercise Library Functions
// ===============================================
function loadExerciseLibrary() {
    displayExercises('all');
}

window.filterExercises = (category) => {
    // Update active filter button
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    event.target.classList.add('active');
    
    displayExercises(category);
};

function displayExercises(category) {
    const exercisesGrid = document.getElementById('exercises-grid');
    exercisesGrid.innerHTML = '';
    
    const filtered = category === 'all' 
        ? defaultExercises 
        : defaultExercises.filter(e => e.category === category);
    
    filtered.forEach(exercise => {
        const exerciseCard = document.createElement('div');
        exerciseCard.className = 'exercise-card';
        exerciseCard.innerHTML = `
            <div class="exercise-card-header">
                <div class="exercise-card-title">${exercise.name}</div>
                <div class="exercise-card-category">${exercise.category}</div>
            </div>
            <div class="exercise-card-muscles">${exercise.muscles.join(', ')}</div>
            <div class="exercise-card-difficulty">
                ${Array.from({length: 5}, (_, i) => 
                    `<span class="difficulty-star ${i < exercise.difficulty ? 'filled' : ''}">★</span>`
                ).join('')}
            </div>
        `;
        
        exerciseCard.onclick = () => {
            // Launch the add exercise modal with the exercise name prefilled
            addExercise(exercise.name);
        };
        
        exercisesGrid.appendChild(exerciseCard);
    });
}

// Search functionality
document.addEventListener('DOMContentLoaded', () => {
  // ---- Auto-upgrade any <img src="users/..."> to signed HTTPS URLs
  function needsUpgrade(src) {
    return src && !/^https?:\/\//i.test(src) && /(\/)?users\//i.test(src);
  }

  async function upgradeImg(el) {
    try {
      const raw = el.getAttribute('src');
      if (!needsUpgrade(raw)) return;
      const url = await resolveStorageURL(raw);
      if (url) {
        el.setAttribute('src', url);
        console.log('[photos] upgraded raw src -> URL', raw, '=>', url.slice(0, 60) + '…');
      }
    } catch (e) {
      console.warn('[photos] upgradeImg failed', e?.message || e);
    }
  }

  // Initial pass over existing images
  (async () => {
    const imgs = Array.from(document.querySelectorAll('img'));
    for (const img of imgs) {
      await upgradeImg(img);
    }
  })();

  // Observe DOM for any new images and upgrade them too
  const mo = new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === 'childList') {
        m.addedNodes.forEach((node) => {
          if (node.nodeType === 1) {
            if (node.tagName === 'IMG') upgradeImg(node);
            node.querySelectorAll && node.querySelectorAll('img').forEach(upgradeImg);
          }
        });
      } else if (m.type === 'attributes' && m.target && m.attributeName === 'src' && m.target.tagName === 'IMG') {
        upgradeImg(m.target);
      }
    }
  });
  mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });

  // Wire up both hidden file inputs for progress photos (camera & library)
  const _photoInputCam = document.getElementById('photo-input-camera');
  const _photoInputLib = document.getElementById('photo-input-library');

  if (_photoInputCam && !_photoInputCam.dataset.wired) {
    _photoInputCam.addEventListener('change', window.handlePhotoUpload);
    _photoInputCam.dataset.wired = '1';
  }
  if (_photoInputLib && !_photoInputLib.dataset.wired) {
    _photoInputLib.addEventListener('change', window.handlePhotoUpload);
    _photoInputLib.dataset.wired = '1';
  }

  // Setup muscle group drop-downs for the exercise and PR modals.  When the
  // category changes, populate the sub-group select with the appropriate
  // options.  If the category has only one option, hide the sub-select.
  const catSelect = document.getElementById('muscle-category');
  const subSelect = document.getElementById('muscle-sub');
  if (catSelect && subSelect) {
    catSelect.addEventListener('change', () => {
      const selected = catSelect.value;
      const subs = muscleOptions[selected] || [];
      // Clear previous options
      subSelect.innerHTML = '<option value="">Select specific muscle</option>';
      if (subs.length > 1) {
        subSelect.style.display = '';
        subs.forEach(mus => {
          const opt = document.createElement('option');
          opt.value = mus;
          opt.textContent = mus;
          subSelect.appendChild(opt);
        });
      } else if (subs.length === 1) {
        subSelect.style.display = 'none';
        // Preselect the only option for convenience
        subSelect.value = subs[0];
      } else {
        subSelect.style.display = 'none';
        subSelect.value = '';
      }
    });
  }

  // Setup muscle group drop-downs for the PR modal
  const prCatSelect = document.getElementById('pr-muscle-category');
  const prSubSelect = document.getElementById('pr-muscle-sub');
  if (prCatSelect && prSubSelect) {
    prCatSelect.addEventListener('change', () => {
      const selected = prCatSelect.value;
      const subs = muscleOptions[selected] || [];
      // Clear previous options and set placeholder
      prSubSelect.innerHTML = '<option value="">Select specific muscle</option>';
      if (subs.length > 1) {
        prSubSelect.style.display = '';
        subs.forEach(mus => {
          const opt = document.createElement('option');
          opt.value = mus;
          opt.textContent = mus;
          prSubSelect.appendChild(opt);
        });
      } else if (subs.length === 1) {
        prSubSelect.style.display = 'none';
        prSubSelect.value = subs[0];
      } else {
        prSubSelect.style.display = 'none';
        prSubSelect.value = '';
      }
    });
  }

  // Setup muscle group drop-downs for the routine exercise modal.  When
  // the main category changes, populate the sub-select accordingly.
  const rtCatSelect = document.getElementById('routine-muscle-category');
  const rtSubSelect = document.getElementById('routine-muscle-sub');
  if (rtCatSelect && rtSubSelect) {
    rtCatSelect.addEventListener('change', () => {
      const selected = rtCatSelect.value;
      const subs = muscleOptions[selected] || [];
      // Reset sub options
      rtSubSelect.innerHTML = '<option value="">Select specific muscle</option>';
      if (subs.length > 1) {
        rtSubSelect.style.display = '';
        subs.forEach(mus => {
          const opt = document.createElement('option');
          opt.value = mus;
          opt.textContent = mus;
          rtSubSelect.appendChild(opt);
        });
      } else if (subs.length === 1) {
        rtSubSelect.style.display = 'none';
        rtSubSelect.value = subs[0];
      } else {
        rtSubSelect.style.display = 'none';
        rtSubSelect.value = '';
      }
    });
  }

  const searchInput = document.getElementById('exercise-search');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      const searchTerm = e.target.value.toLowerCase();
      const filtered = defaultExercises.filter(exercise => 
        exercise.name.toLowerCase().includes(searchTerm) ||
        exercise.muscles.some(muscle => muscle.toLowerCase().includes(searchTerm))
      );

      const exercisesGrid = document.getElementById('exercises-grid');
      exercisesGrid.innerHTML = '';

      filtered.forEach(exercise => {
        const exerciseCard = document.createElement('div');
        exerciseCard.className = 'exercise-card';
        exerciseCard.innerHTML = `
            <div class="exercise-card-header">
                <div class="exercise-card-title">${exercise.name}</div>
                <div class="exercise-card-category">${exercise.category}</div>
            </div>
            <div class="exercise-card-muscles">${exercise.muscles.join(', ')}</div>
            <div class="exercise-card-difficulty">
                ${Array.from({length: 5}, (_, i) => 
                    `<span class="difficulty-star ${i < exercise.difficulty ? 'filled' : ''}">★</span>`
                ).join('')}
            </div>
        `;

        exerciseCard.onclick = () => {
          // Launch the add exercise modal with the exercise name prefilled
          addExercise(exercise.name);
        };

        exercisesGrid.appendChild(exerciseCard);
      });
    });
  }

  // Delegate click events on the exercises list to toggle set completion
  const exercisesListEl = document.getElementById('exercises-list');
  if (exercisesListEl && !exercisesListEl.dataset.toggling) {
    exercisesListEl.addEventListener('click', (e) => {
      const target = e.target;
      if (!target || !target.classList) return;
      // Handle set deletion when clicking the remove button
      if (target.classList.contains('set-remove')) {
        const exIndex = parseInt(target.dataset.exerciseIndex);
        const setIndex = parseInt(target.dataset.setIndex);
        if (isNaN(exIndex) || isNaN(setIndex)) return;
        const exerciseObj = currentWorkout?.exercises?.[exIndex];
        if (!exerciseObj) return;
        // Only allow deletion if there is more than one set
        if (exerciseObj.sets.length > 1) {
          exerciseObj.sets.splice(setIndex, 1);
          // Re-render exercises list to update indexes and volume
          const list = document.getElementById('exercises-list');
          if (list) {
            list.innerHTML = '';
            currentWorkout.exercises.forEach(ex => displayExercise(ex));
          }
        }
        return;
      }
      // Toggle set completion when clicking the status circle
      if (target.classList.contains('set-status')) {
        const exIndex = parseInt(target.dataset.exerciseIndex);
        const setIndex = parseInt(target.dataset.setIndex);
        if (isNaN(exIndex) || isNaN(setIndex)) return;
        const exerciseObj = currentWorkout?.exercises?.[exIndex];
        if (!exerciseObj) return;
        const setObj = exerciseObj.sets[setIndex];
        setObj.completed = !setObj.completed;
        target.classList.toggle('completed');
        target.textContent = setObj.completed ? '✓' : '○';
        // Update the volume displayed for this exercise
        const parentExerciseEl = target.closest('.exercise-item');
        if (parentExerciseEl) {
          const volumeEl = parentExerciseEl.querySelector('.exercise-volume');
          const newVol = exerciseObj.sets.filter(s => s.completed).reduce((sum, s) => sum + s.weight * s.reps, 0);
          if (volumeEl) volumeEl.textContent = `${newVol} lbs`;
        }
        return;
      }
      // Add a new set inline when clicking the plus button
      if (target.classList.contains('inline-add-set') || (target.parentElement && target.parentElement.classList && target.parentElement.classList.contains('inline-add-set'))) {
        // If the user clicks the icon within the button, use the button as target
        const btn = target.classList.contains('inline-add-set') ? target : target.parentElement;
        const exIndex = parseInt(btn.dataset.exerciseIndex);
        if (isNaN(exIndex)) return;
        const exerciseObj = currentWorkout?.exercises?.[exIndex];
        if (!exerciseObj) return;
        // Append a new default set to the exercise
        exerciseObj.sets.push({ weight: 0, reps: 0, completed: false });
        // Re-render all exercises to maintain proper ordering and updated indexes
        const list = document.getElementById('exercises-list');
        if (list) {
          list.innerHTML = '';
          currentWorkout.exercises.forEach(ex => displayExercise(ex));
        }
        return;
      }
    });
    exercisesListEl.dataset.toggling = '1';

    // Listen for changes on weight and reps inputs to update the underlying
    // workout data and recalculate volume.  This provides inline editing
    // without popups.
    exercisesListEl.addEventListener('input', (ev) => {
      const tgt = ev.target;
      if (!tgt || !tgt.classList) return;
      if (tgt.classList.contains('set-display-weight') || tgt.classList.contains('set-display-reps')) {
        const exIndex = parseInt(tgt.dataset.exerciseIndex);
        const setIndex = parseInt(tgt.dataset.setIndex);
        if (isNaN(exIndex) || isNaN(setIndex)) return;
        const exerciseObj = currentWorkout?.exercises?.[exIndex];
        if (!exerciseObj) return;
        const setObj = exerciseObj.sets[setIndex];
        if (tgt.classList.contains('set-display-weight')) {
          const val = parseFloat(tgt.value);
          setObj.weight = isNaN(val) || val < 0 ? 0 : val;
        } else {
          const val = parseInt(tgt.value);
          setObj.reps = isNaN(val) || val < 0 ? 0 : val;
        }
        // Update volume display
        const parentExerciseEl = tgt.closest('.exercise-item');
        if (parentExerciseEl) {
          const volumeEl = parentExerciseEl.querySelector('.exercise-volume');
          const newVol = exerciseObj.sets.filter(s => s.completed).reduce((sum, s) => sum + s.weight * s.reps, 0);
          if (volumeEl) volumeEl.textContent = `${newVol} lbs`;
        }
      }
    });
  }
});

// ===============================================
// Utility Functions
// ===============================================
// Resolve a Storage path (e.g. "users/<uid>/.../file.jpg") to a public HTTPS URL
// Resolve a Storage path (e.g. "users/<uid>/.../file.jpg") to a public HTTPS URL
async function resolveStorageURL(pathOrUrl) {
  try {
    if (!pathOrUrl) return null;
    // Already a URL? return as-is.
    if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;

    // Normalize: strip any leading "/" so Storage ref treats it as an object path
    const normalized = String(pathOrUrl).replace(/^\/+/, '');
    const r = ref(storage, normalized);
    const u = await getDownloadURL(r);
    return u;
  } catch (e) {
    console.warn('[photos] resolveStorageURL failed for', pathOrUrl, e?.message || e);
    return null;
  }
}

function showNotification(message, type = 'info') {
    // Create notification element
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.innerHTML = `
        <div class="notification-content">
            <i class="fas fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : 'info-circle'}"></i>
            <span>${message}</span>
        </div>
    `;
    
    // Add styles if not already in CSS
    const style = document.createElement('style');
    style.textContent = `
        .notification {
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 15px 20px;
            border-radius: 10px;
            background: rgba(10, 10, 10, 0.95);
            border: 2px solid;
            color: white;
            z-index: 10000;
            animation: slideInRight 0.3s ease;
            max-width: 350px;
        }
        
        .notification-success {
            border-color: #10B981;
            box-shadow: 0 0 20px rgba(16, 185, 129, 0.5);
        }
        
        .notification-error {
            border-color: #EF4444;
            box-shadow: 0 0 20px rgba(239, 68, 68, 0.5);
        }
        
        .notification-info {
            border-color: #3B82F6;
            box-shadow: 0 0 20px rgba(59, 130, 246, 0.5);
        }
        
        .notification-content {
            display: flex;
            align-items: center;
            gap: 10px;
        }
        
        @keyframes slideInRight {
            from {
                transform: translateX(100%);
                opacity: 0;
            }
            to {
                transform: translateX(0);
                opacity: 1;
            }
        }
    `;
    
    if (!document.querySelector('style[data-notifications]')) {
        style.setAttribute('data-notifications', 'true');
        document.head.appendChild(style);
    }
    
    document.body.appendChild(notification);
    
    // Remove after 3 seconds
    setTimeout(() => {
        notification.style.animation = 'slideInRight 0.3s ease reverse';
        setTimeout(() => {
            notification.remove();
        }, 300);
    }, 3000);
}

function formatDuration(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    if (hours > 0) {
        return `${hours}h ${minutes}m`;
    } else if (minutes > 0) {
        return `${minutes}m ${secs}s`;
    } else {
        return `${secs}s`;
    }
}

function getErrorMessage(errorCode) {
    const errorMessages = {
        'auth/email-already-in-use': 'This email is already registered. Try logging in instead.',
        'auth/invalid-email': 'Invalid email address.',
        'auth/operation-not-allowed': 'Operation not allowed. Please contact support.',
        'auth/weak-password': 'Password is too weak. Use at least 6 characters.',
        'auth/user-disabled': 'This account has been disabled.',
        'auth/user-not-found': 'No account found with this email.',
        'auth/wrong-password': 'Incorrect password.',
        'auth/invalid-credential': 'Invalid email or password.',
        'auth/too-many-requests': 'Too many failed attempts. Please try again later.',
        'auth/network-request-failed': 'Network error. Please check your connection.',
        'auth/configuration-not-found': 'Auth is not fully set up for this domain. Make sure your domain is authorized in Firebase Auth and the API key referrer allowlist includes this origin.'
    };
    
    return errorMessages[errorCode] || 'An error occurred. Please try again.';
}

function getMuscleGroups(muscleNames) {
    const muscleMapping = {
        'Pectorals': 'chest',
        'Upper Chest': 'upper-chest',
        'Lower Chest': 'lower-chest',
        'Triceps': 'triceps',
        'Biceps': 'biceps',
        'Forearms': 'forearms',
        'Front Delts': 'front-delts',
        'Side Delts': 'side-delts',
        'Rear Delts': 'rear-delts',
        'All Delts': ['front-delts', 'side-delts', 'rear-delts'],
        'Lats': 'lats',
        'Mid Back': 'mid-back',
        'Lower Back': 'lower-back',
        'Traps': 'traps',
        'Quads': 'quads',
        'Hamstrings': 'hamstrings',
        'Glutes': 'glutes',
        'Calves': 'calves',
        'Abs': 'abs',
        'Lower Abs': 'abs',
        'Obliques': 'obliques'
    };
    
    const muscles = [];
    muscleNames.forEach(name => {
        const mapped = muscleMapping[name];
        if (mapped) {
            if (Array.isArray(mapped)) {
                muscles.push(...mapped);
            } else {
                muscles.push(mapped);
            }
        }
    });
    
    return [...new Set(muscles)]; // Remove duplicates
}

// ===============================================
// Placeholder Functions (for future implementation)
// ===============================================
window.toggleNotifications = () => {
    showNotification('Notifications feature coming soon!', 'info');
};

window.toggleProfile = () => {
    showNotification('Profile settings coming soon!', 'info');
};

// ===============================================
// Initialize App
// ===============================================
console.log('GymTracker Pro initialized! 🐢💪');

// ---- TEMP: auth status logger (prints for ~60s)
{
  let _i = 0;
  const _t = setInterval(() => {
    _i++;
    const u = auth.currentUser;
    console.log('[AUTH]', !!u, u?.uid || null);
    if (_i > 30) clearInterval(_t);
  }, 2000);
}
