import React from "react";
import { Bell, Search, HelpCircle } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function TopBar() {
  const { user } = useAuth();
  const today = new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });

  return (
    <header className="h-14 bg-white border-b border-border flex items-center justify-between px-5 gap-4 sticky top-0 z-20">
      {/* Date */}
      <div className="hidden md:block">
        <p className="text-xs text-muted-foreground capitalize">{today}</p>
      </div>

      {/* Search */}
      <div className="flex-1 max-w-xs relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
        <Input
          placeholder="Rechercher..."
          className="pl-8 h-8 text-xs bg-muted border-0 focus-visible:ring-1"
        />
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground relative">
          <Bell className="w-4 h-4" />
          <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 bg-primary rounded-full"></span>
        </Button>
        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground">
          <HelpCircle className="w-4 h-4" />
        </Button>
        <div className="w-7 h-7 rounded-full gradient-primary flex items-center justify-center text-white text-xs font-bold cursor-pointer ml-1">
          {user?.full_name?.charAt(0) || "J"}
        </div>
      </div>
    </header>
  );
}
