import { initializeApp, getApps } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyD1jcObZyK2yl2q4uHs6qIasRp5hL3sj0g",
  authDomain: "shary-incidents.firebaseapp.com",
  projectId: "shary-incidents",
  storageBucket: "shary-incidents.appspot.com",
  messagingSenderId: "289197140600",
  appId: "1:289197140600:web:acc336ae61aae383c61b8d",
};

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
