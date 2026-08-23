
"use client";

import { confirmDiscardUnsavedChanges } from '@/lib/unsavedChanges';
import React from "react"; 
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme, type ThemePreference } from "@/contexts/ThemeContext";
import { LogOut, User as UserIcon, Loader2, Download, Sun, Moon, Monitor } from "lucide-react";
import { useRouter } from "next/navigation";
import { ExportLogsDialog } from "./ExportLogsDialog";

export function UserNav() {
  const { user, logout, isLoading: authIsLoading } = useAuth();
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const [isLoggingOut, setIsLoggingOut] = React.useState(false);
  const [isExportDialogOpen, setIsExportDialogOpen] = React.useState(false);


  const handleLogout = async () => {
    if (!confirmDiscardUnsavedChanges()) return;
    setIsLoggingOut(true);
    try {
      await logout();
      router.push("/login");
    } catch (error) {
      console.error("Logout failed", error);
    } finally {
      setIsLoggingOut(false);
    }
  };

  if (authIsLoading) {
     return (
      <div className="flex items-center justify-center h-9 w-9">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return null; 
  }

  const initials = user.name
    ? user.name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
    : user.email ? user.email[0].toUpperCase() : "U";

  return (
    <>
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="relative h-9 w-9 rounded-full">
          <Avatar className="h-9 w-9">
            <AvatarImage src={user.avatarUrl || undefined} alt={user.name || user.email || "User avatar"} />
            <AvatarFallback>{initials}</AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56" align="end" forceMount>
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col space-y-1">
            <p className="text-sm font-medium leading-none font-headline">{user.name || "User"}</p>
            {user.email && (
              <p className="text-xs leading-none text-muted-foreground">
                {user.email}
              </p>
            )}
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={() => { if (confirmDiscardUnsavedChanges()) router.push('/profile'); }}>
            <UserIcon className="mr-2 h-4 w-4" />
            <span>Profile</span>
          </DropdownMenuItem>
           <DropdownMenuItem onClick={() => setIsExportDialogOpen(true)} disabled={isLoggingOut || authIsLoading}>
            <Download className="mr-2 h-4 w-4" />
            <span>Export Data</span>
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              {theme === 'dark' ? <Moon className="mr-2 h-4 w-4" /> : theme === 'light' ? <Sun className="mr-2 h-4 w-4" /> : <Monitor className="mr-2 h-4 w-4" />}
              <span>Theme</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuRadioGroup value={theme} onValueChange={(v) => setTheme(v as ThemePreference)}>
                <DropdownMenuRadioItem value="light"><Sun className="mr-2 h-4 w-4" />Light</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="dark"><Moon className="mr-2 h-4 w-4" />Dark</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="system"><Monitor className="mr-2 h-4 w-4" />System</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleLogout} disabled={isLoggingOut}>
          {isLoggingOut ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <LogOut className="mr-2 h-4 w-4" />}
          <span>Log out</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    <ExportLogsDialog isOpen={isExportDialogOpen} setIsOpen={setIsExportDialogOpen} />
    </>
  );
}
