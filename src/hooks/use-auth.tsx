
"use client";
import {useState, useEffect, createContext, useContext, ReactNode} from 'react';
import {onAuthStateChanged, signInAnonymously, User as FirebaseAuthUser, Auth, AuthError} from 'firebase/auth';
import { auth, firestore } from '@/lib/firebase/config';
import {doc, onSnapshot} from 'firebase/firestore';
import type {User as AppUser} from '@/lib/types';
import { Button } from '@/components/ui/button';

interface AuthContextType {
    user: FirebaseAuthUser | null;
    appUser: AppUser | null;
    loading: boolean;
    authError: string | null;
    auth: Auth | null;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({children}: {children: ReactNode}) => {
    const [user, setUser] = useState<FirebaseAuthUser | null>(null);
    const [appUser, setAppUser] = useState<AppUser | null>(null);
    const [loading, setLoading] = useState(true);
    const [authError, setAuthError] = useState<string|null>(null);

    useEffect(() => {
        const performSignIn = async () => {
            try {
                // Attempt to sign in anonymously
                await signInAnonymously(auth);
            } catch (error) {
                const caughtError = error as AuthError;
                console.error("Anonymous Sign-In Error:", caughtError.code, caughtError.message);
                if (caughtError.code === 'auth/admin-restricted-operation' || caughtError.code === 'auth/operation-not-allowed') {
                    setAuthError("Anonymous sign-in is not enabled for this Firebase project.");
                } else {
                     setAuthError("An unexpected authentication error occurred. Please try again.");
                }
                setLoading(false);
            }
        };

        const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
            if (firebaseUser) {
                // User is signed in
                setUser(firebaseUser);
                const userRef = doc(firestore, 'users', firebaseUser.uid);
                const unsubUser = onSnapshot(userRef, (docSnap) => {
                   if (docSnap.exists()) {
                       setAppUser({uid: docSnap.id, ...docSnap.data()} as AppUser);
                   } else {
                       // User document doesn't exist yet, it will be created on the home page.
                       setAppUser(null);
                   }
                   setLoading(false);
                }, (error) => {
                  console.error("Error fetching app user:", error);
                  setAppUser(null);
                  setLoading(false);
                });
                return () => unsubUser();
            } else {
                // User is signed out, attempt to sign them in
                setUser(null);
                setAppUser(null);
                performSignIn();
            }
        });

        return () => unsubscribe();
    }, []);

    const value = {user, appUser, loading, authError, auth};
    
    if (loading) {
        return (
            <div className="flex h-screen items-center justify-center">
               <p className="text-muted-foreground">Connecting...</p>
            </div>
       )
    }
    
    if (authError) {
        return (
            <div className="flex h-screen items-center justify-center bg-background text-foreground p-8 text-center">
                <div className="max-w-xl p-8 border rounded-lg shadow-lg bg-card">
                    <h1 className="text-2xl font-bold text-destructive mb-4">Authentication Required</h1>
                    <p className="text-destructive-foreground mb-6">
                        {authError} This is a required setting for the app to function.
                    </p>
                    <div className="bg-secondary p-4 rounded-md text-left">
                        <h2 className="font-semibold text-lg mb-2">How to fix this:</h2>
                        <ol className="list-decimal list-inside space-y-2 text-muted-foreground">
                            <li>Go to your project in the <a href="https://console.firebase.google.com/" target="_blank" rel="noopener noreferrer" className="underline text-primary">Firebase Console</a>.</li>
                            <li>Navigate to the <strong>Authentication</strong> section.</li>
                            <li>Click the <strong>Sign-in method</strong> tab.</li>
                            <li>Find <strong>Anonymous</strong> in the provider list and enable it.</li>
                            <li>Refresh this page.</li>
                        </ol>
                    </div>
                     <Button onClick={() => window.location.reload()} className="mt-6">
                        I've enabled it, refresh the page
                    </Button>
                </div>
            </div>
        )
    }

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
};
