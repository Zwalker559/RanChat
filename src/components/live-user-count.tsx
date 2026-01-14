"use client";

import { useState, useEffect } from "react";
import { Users } from "lucide-react";
import { collection, onSnapshot } from "firebase/firestore";
import { firestore } from "@/lib/firebase/config";

export function LiveUserCount() {
  const [userCount, setUserCount] = useState<number>(0);

  useEffect(() => {
    // Listen to the /active_users collection for real-time updates.
    // This is more efficient and aligns with the security rules.
    const activeUsersCol = collection(firestore, 'active_users');
    
    const unsubscribe = onSnapshot(activeUsersCol, (snapshot) => {
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
        {userCount > 0 ? `${userCount.toLocaleString()} users online` : "Connecting..."}
      </span>
    </div>
  );
}
