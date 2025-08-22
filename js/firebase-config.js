// Replace with your actual Firebase project config
const firebaseConfig = {
  apiKey: "AIzaSyD2-oIhFYCdCiSdNWupF_WFhlDK2NQD_P8",
  authDomain: "ifrs-eaaa9.firebaseapp.com",
  projectId: "ifrs-eaaa9",
  storageBucket: "ifrs-eaaa9.firebasestorage.app",
  messagingSenderId: "567898303529",
  appId: "1:567898303529:web:b81a80462acedeac198038",
  measurementId: "G-HVJZNCNC3Z"
};


// Initialize Firebase
firebase.initializeApp(firebaseConfig);
export const auth = firebase.auth();
