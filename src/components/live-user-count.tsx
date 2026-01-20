
"use client";

import { useState, useEffect } from "react";
import { Users } from "lucide-react";
import { collection, onSnapshot } from "firebase/firestore";
import { firestore } from "@/lib/firebase/config";

export function LiveUserCount() {
  const [userCount, setUserCount] = useState<number>(0);

  useEffect(() => {
    // Listen to the /users collection for real-time updates.
    // Any document in this collection represents an online user,
    // as offline users have their documents deleted.
    const usersCol = collection(firestore, 'users');
    
    const unsubscribe = onSnapshot(usersCol, (snapshot) => {
        setUserCount(snapshot.size);
    }, (error) => {
      console.error("Error fetching active user count:", error);
      setUserCount(0); // Set to 0 on error
    });

    return () => unsubscribe();
  }, []);

  return (
    <div className="flex items-center justify-center gap-2 text-lg text-muted-foreground">
      <Users className="h-5 w-5 text-accent" />
      <span className="font-medium">
        {userCount > 0 ? `${userCount.toLocaleString()} user${userCount === 1 ? '' : 's'} online` : "No one is online"}
      </span>
    </div>
  );
}
