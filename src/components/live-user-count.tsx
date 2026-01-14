"use client";

import { useState, useEffect } from "react";
import { Users } from "lucide-react";

export function LiveUserCount() {
  const [userCount, setUserCount] = useState<number>(0);

  useEffect(() => {
    setUserCount(Math.floor(Math.random() * 1000) + 500);
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
