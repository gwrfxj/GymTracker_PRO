// ===============================================
// GymTracker Pro - Main JavaScript Module
// ===============================================

// Import Firebase modules
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";
import { initializeAppCheck, ReCaptchaV3Provider } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app-check.js";
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
import { 
    getFirestore,
    doc,
    setDoc,
    getDoc,
    updateDoc,
    deleteDoc,
    collection,
    addDoc,
    query,
    where,
    orderBy,
    limit,
    getDocs,
    serverTimestamp,
    Timestamp,
    onSnapshot
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import {
    getStorage,
    ref,
    uploadBytes,
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
  storageBucket: "gymtracker-pro-7ac65.appspot.com",
  messagingSenderId: "321858828026",
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

// ---- App Check (reCAPTCHA v3)
// Only run App Check on production hosts, or when a debug token is explicitly set.
// For local dev, go to Firebase Console → App Check → Debug tokens, create one,
// then paste it below and refresh. Remove it again before committing.

// Enable App Check debug on localhost automatically.
// If you already created a Debug Token in Console → App Check → Debug tokens,
// you can paste it into localStorage under the key "APPCHECK_DEBUG_TOKEN"
// and it will be used automatically. Otherwise, we do NOT enable debug mode unless a token is present.
if (IS_LOCAL) {
  try {
    const savedToken = localStorage.getItem('APPCHECK_DEBUG_TOKEN');
    if (savedToken && savedToken.trim()) {
      self.FIREBASE_APPCHECK_DEBUG_TOKEN = savedToken.trim();
      console.info('[AppCheck] Using debug token from localStorage.');
    } else {
      console.info('[AppCheck] Localhost detected and no debug token found in localStorage. Skipping App Check locally.');
    }
  } catch (e) {
    console.warn('[AppCheck] Could not read debug token from localStorage:', e?.message || e);
  }
}
try {
  // Uncomment this line after you add a debug token in the Console for localhost:
  // if (IS_LOCAL) self.FIREBASE_APPCHECK_DEBUG_TOKEN = 'PASTE_DEBUG_TOKEN_HERE';

  if (IS_PROD_HOST || self.FIREBASE_APPCHECK_DEBUG_TOKEN) {
    initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider('6Lc_LqkrAAAAAM7iXwzE4JwocEnFPrS3I1rxVot6'),
      isTokenAutoRefreshEnabled: true
    });
  } else {
    console.info('App Check skipped on localhost (no debug token).');
  }
} catch (e) {
  console.warn('App Check init skipped:', e?.message || e);
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
const db = getFirestore(app);
const storage = getStorage(app);

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
    await loadUserData();
    showMainDashboard();
    hideLoadingScreen();
  } else {
    currentUser = null;
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
            
            // Update stats
            document.getElementById('total-workouts').textContent = userData.stats?.totalWorkouts || 0;
            document.getElementById('total-weight').textContent = `${userData.stats?.totalWeight || 0} lbs`;
            document.getElementById('total-prs').textContent = Object.keys(userData.stats?.personalRecords || {}).length;
            
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

window.addExercise = () => {
    document.getElementById('exercise-modal').style.display = 'flex';
    document.getElementById('exercise-name').value = '';
    document.getElementById('sets-container').innerHTML = '';
    addSet(); // Add first set by default
};

window.closeExerciseModal = () => {
    document.getElementById('exercise-modal').style.display = 'none';
};

window.addSet = () => {
    const setsContainer = document.getElementById('sets-container');
    const setNumber = setsContainer.children.length + 1;
    
    const setRow = document.createElement('div');
    setRow.className = 'set-row';
    setRow.innerHTML = `
        <span class="set-number">Set ${setNumber}</span>
        <input type="number" class="set-input" placeholder="Weight" id="weight-${setNumber}">
        <input type="number" class="set-input" placeholder="Reps" id="reps-${setNumber}">
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
        const weight = row.querySelector(`#weight-${index + 1}`).value;
        const reps = row.querySelector(`#reps-${index + 1}`).value;
        const completed = row.querySelector('.set-complete').classList.contains('completed');
        
        if (weight && reps) {
            sets.push({ weight: parseFloat(weight), reps: parseInt(reps), completed });
        }
    });
    
    if (sets.length === 0) {
        showNotification('Please add at least one set with weight and reps', 'error');
        return;
    }
    
    // Add to current workout
    const exercise = {
        name: exerciseName,
        sets: sets,
        timestamp: new Date()
    };
    
    currentWorkout.exercises.push(exercise);
    
    // Update UI
    displayExercise(exercise);
    
    // Find and update muscles worked
    const exerciseData = defaultExercises.find(e => 
        e.name.toLowerCase() === exerciseName.toLowerCase()
    );
    
    if (exerciseData) {
        const musclesToUpdate = getMuscleGroups(exerciseData.muscles);
        updateMusclesWorked(musclesToUpdate);
    }
    
    closeExerciseModal();
    showNotification('Exercise added!', 'success');
};

function displayExercise(exercise) {
    const exercisesList = document.getElementById('exercises-list');
    
    const exerciseItem = document.createElement('div');
    exerciseItem.className = 'exercise-item';
    
    const totalVolume = exercise.sets.reduce((sum, set) => sum + (set.weight * set.reps), 0);
    
    exerciseItem.innerHTML = `
        <div class="exercise-header">
            <span class="exercise-name">${exercise.name}</span>
            <span class="exercise-volume">${totalVolume} lbs</span>
        </div>
        <div class="exercise-sets">
            ${exercise.sets.map((set, index) => `
                <div class="set-row">
                    <span class="set-number">Set ${index + 1}</span>
                    <span>${set.weight} lbs</span>
                    <span>${set.reps} reps</span>
                    <span class="set-status ${set.completed ? 'completed' : ''}">
                        ${set.completed ? '✓' : '○'}
                    </span>
                </div>
            `).join('')}
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
    
    clearInterval(workoutTimer);
    
    const endTime = new Date();
    const duration = Math.floor((endTime - currentWorkout.startTime) / 1000); // in seconds
    
    // Calculate total volume
    const totalVolume = currentWorkout.exercises.reduce((total, exercise) => {
        return total + exercise.sets.reduce((sum, set) => sum + (set.weight * set.reps), 0);
    }, 0);
    
    try {
        // Save workout to Firestore
        await addDoc(collection(db, 'users', currentUser.uid, 'workouts'), { userId: currentUser.uid, 
            startTime: Timestamp.fromDate(currentWorkout.startTime),
            endTime: Timestamp.fromDate(endTime),
            duration: duration,
            exercises: currentWorkout.exercises,
            totalVolume: totalVolume,
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

        await updateDoc(userRef, {
        'stats.totalWorkouts': (currentStats.totalWorkouts ?? 0) + 1,
        'stats.totalWeight': (currentStats.totalWeight ?? 0) + totalVolume,
        'stats.lastWorkout': serverTimestamp()
        });
        
        // Reset workout UI
        document.getElementById('active-workout').style.display = 'none';
        document.getElementById('workout-timer').textContent = '00:00:00';
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
        const q = query(workoutsRef, orderBy('createdAt', 'desc'), limit(10));
        const querySnapshot = await getDocs(q);
        
        const historyList = document.getElementById('history-list');
        historyList.innerHTML = '';
        
        if (querySnapshot.empty) {
            historyList.innerHTML = '<p style="color: rgba(255,255,255,0.5);">No workouts yet. Start your first workout!</p>';
            return;
        }
        
        querySnapshot.forEach((doc) => {
            const workout = doc.data();
            const date = workout.startTime.toDate();
            const exercises = workout.exercises.map(e => e.name).join(', ');
            
            const historyItem = document.createElement('div');
            historyItem.className = 'history-item';
            historyItem.innerHTML = `
                <div class="history-date">${date.toLocaleDateString()} - ${date.toLocaleTimeString()}</div>
                <div class="history-exercises">${exercises}</div>
                <div class="history-stats">
                    <span>Duration: ${formatDuration(workout.duration)}</span>
                    <span>Volume: ${workout.totalVolume} lbs</span>
                </div>
            `;
            
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
        routineItem.innerHTML = `
            <div class="routine-name">${routine.name}</div>
            <div class="routine-exercises">${routine.exercises.length} exercises</div>
        `;
        routineItem.onclick = () => startRoutineWorkout(routine);
        
        routinesList.appendChild(routineItem);
    });
}

function startRoutineWorkout(routine) {
    closeRoutinesModal();
    startWorkout();
    
    // Pre-populate with routine exercises
    routine.exercises.forEach(exercise => {
        currentWorkout.exercises.push({
            name: exercise.name,
            sets: exercise.sets.map(set => ({ ...set, completed: false })),
            timestamp: new Date()
        });
        displayExercise(currentWorkout.exercises[currentWorkout.exercises.length - 1]);
    });
    
    showNotification(`Started workout with ${routine.name} routine`, 'success');
}

// ===============================================
// Progress Tab Functions
// ===============================================
window.addPR = async () => {
    const exercise = prompt('Exercise name:');
    if (!exercise) return;
    
    const weight = prompt('Weight (lbs):');
    if (!weight) return;
    
    const reps = prompt('Reps:');
    if (!reps) return;
    
    try {
        const userRef = doc(db, 'users', currentUser.uid);
        await updateDoc(userRef, {
            [`stats.personalRecords.${exercise}`]: {
                weight: parseFloat(weight),
                reps: parseInt(reps),
                date: serverTimestamp()
            }
        });
        
        await loadPRs();
        showNotification('Personal Record added! 🏆', 'success');
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
            prItem.innerHTML = `
                <div class="pr-exercise">${exercise}</div>
                <div class="pr-value">${record.weight} lbs × ${record.reps}</div>
                <div class="pr-date">${record.date?.toDate ? record.date.toDate().toLocaleDateString() : 'Recent'}</div>
            `;
            prsList.appendChild(prItem);
        });
    } catch (error) {
        console.error('Error loading PRs:', error);
    }
}

// Photo Progress
window.addProgressPhoto = () => {
    document.getElementById('photo-input').click();
};

window.handlePhotoUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    
    try {
        // Upload to Firebase Storage
        const storageRef = ref(storage, `users/${currentUser.uid}/progress/${Date.now()}_${file.name}`);
        const snapshot = await uploadBytes(storageRef, file);
        const downloadURL = await getDownloadURL(snapshot.ref);
        
        // Save reference in Firestore
        await addDoc(collection(db, 'users', currentUser.uid, 'progressPhotos'), { userId: currentUser.uid, 
            url: downloadURL,
            uploadedAt: serverTimestamp()
        });
        
        await loadProgressPhotos();
        showNotification('Photo uploaded successfully!', 'success');
    } catch (error) {
        console.error('Error uploading photo:', error);
        showNotification('Error uploading photo', 'error');
    }
};

async function loadProgressPhotos() {
    if (!currentUser) return;
    
    try {
        const photosRef = collection(db, 'users', currentUser.uid, 'progressPhotos');
        const q = query(photosRef, orderBy('uploadedAt', 'desc'), limit(12));
        const querySnapshot = await getDocs(q);
        
        const photoGrid = document.getElementById('photo-grid');
        photoGrid.innerHTML = '';
        
        querySnapshot.forEach((doc) => {
            const photo = doc.data();
            const photoItem = document.createElement('div');
            photoItem.className = 'photo-item';
            photoItem.innerHTML = `
                <img src="${photo.url}" alt="Progress photo">
                <div class="photo-date">${photo.uploadedAt?.toDate ? photo.uploadedAt.toDate().toLocaleDateString() : 'Recent'}</div>
            `;
            photoGrid.appendChild(photoItem);
        });
    } catch (error) {
        console.error('Error loading photos:', error);
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
        const q = query(measurementsRef, orderBy('date', 'desc'), limit(1));
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
        
        // Update chart placeholder
        document.getElementById('measurements-chart').innerHTML = 
            '<p>Chart visualization coming soon! Track your progress over time.</p>';
    } catch (error) {
        console.error('Error loading measurements:', error);
    }
}

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
            document.getElementById('exercise-name').value = exercise.name;
            addExercise();
        };
        
        exercisesGrid.appendChild(exerciseCard);
    });
}

// Search functionality
document.addEventListener('DOMContentLoaded', () => {
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
                    document.getElementById('exercise-name').value = exercise.name;
                    addExercise();
                };
                
                exercisesGrid.appendChild(exerciseCard);
            });
        });
    }
});

// ===============================================
// Utility Functions
// ===============================================
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
        'Upper Chest': 'chest',
        'Lower Chest': 'chest',
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
        'Obliques': 'abs'
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
