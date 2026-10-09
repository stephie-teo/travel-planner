import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyAi8HgmsS-r8I47LKHT72B710xRialOQyw",
  authDomain: "travel-planner-5c4f9.firebaseapp.com",
  projectId: "travel-planner-5c4f9",
  storageBucket: "travel-planner-5c4f9.firebasestorage.app",
  messagingSenderId: "700961374480",
  appId: "1:700961374480:web:aed43ecaf2070806c82595",
  measurementId: "G-741JC8VC96",
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);

export default app;