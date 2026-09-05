
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
import { useI18n } from "@/contexts/LanguageContext";
import { LANGUAGES, isLanguage, type Language, type TranslationKey } from "@/i18n";
import { useToast } from "@/hooks/use-toast";
import { friendlyErrorMessage } from "@/lib/errorMessages";
import { LogOut, User as UserIcon, Loader2, Download, Sun, Moon, Monitor, Languages } from "lucide-react";
import { useRouter } from "next/navigation";
import { ExportLogsDialog } from "./ExportLogsDialog";

const LANGUAGE_LABEL: Record<Language, TranslationKey> = { en: 'lang.en', es: 'lang.es' };

export function UserNav() {
  const { user, logout, isLoading: authIsLoading } = useAuth();
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const { t, language, setLanguage } = useI18n();
  const { toast } = useToast();
  const [isLoggingOut, setIsLoggingOut] = React.useState(false);
  const [isExportDialogOpen, setIsExportDialogOpen] = React.useState(false);

  // Switches the UI at once; only the profile write can fail, and the choice is
  // still mirrored on this device, so the toast just says it may not roam.
  const handleLanguageChange = (value: string) => {
    if (!isLanguage(value)) return;
    setLanguage(value).catch((error) => {
      console.error('[UserNav] language save failed:', error);
      toast({
        title: t('common.saveErrorTitle'),
        description: friendlyErrorMessage(error, t('userNav.languageSaveError')),
        variant: 'destructive',
      });
    });
  };


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
      <div className="flex h-11 w-11 items-center justify-center md:h-10 md:w-10">
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
        <Button
          variant="ghost"
          className="relative h-11 w-11 shrink-0 rounded-full p-0 md:h-10 md:w-10"
          aria-label={t('userNav.accountMenu')}
        >
          <Avatar className="h-9 w-9">
            <AvatarImage src={user.avatarUrl || undefined} alt={user.name || user.email || t('userNav.avatarAlt')} />
            <AvatarFallback className="text-[13px] font-semibold">{initials}</AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56" align="end" forceMount>
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col space-y-1">
            <p className="text-sm font-medium leading-none font-headline">{user.name || t('userNav.user')}</p>
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
            <span>{t('userNav.profile')}</span>
          </DropdownMenuItem>
           <DropdownMenuItem onClick={() => setIsExportDialogOpen(true)} disabled={isLoggingOut || authIsLoading}>
            <Download className="mr-2 h-4 w-4" />
            <span>{t('userNav.export')}</span>
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              {theme === 'dark' ? <Moon className="mr-2 h-4 w-4" /> : theme === 'light' ? <Sun className="mr-2 h-4 w-4" /> : <Monitor className="mr-2 h-4 w-4" />}
              <span>{t('userNav.theme')}</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuRadioGroup value={theme} onValueChange={(v) => setTheme(v as ThemePreference)}>
                <DropdownMenuRadioItem value="light"><Sun className="mr-2 h-4 w-4" />{t('userNav.light')}</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="dark"><Moon className="mr-2 h-4 w-4" />{t('userNav.dark')}</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="system"><Monitor className="mr-2 h-4 w-4" />{t('userNav.system')}</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Languages className="mr-2 h-4 w-4" />
              <span>{t('userNav.language')}</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuRadioGroup value={language} onValueChange={handleLanguageChange}>
                {LANGUAGES.map((lang) => (
                  <DropdownMenuRadioItem key={lang} value={lang}>{t(LANGUAGE_LABEL[lang])}</DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleLogout} disabled={isLoggingOut}>
          {isLoggingOut ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <LogOut className="mr-2 h-4 w-4" />}
          <span>{t('userNav.logout')}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    <ExportLogsDialog isOpen={isExportDialogOpen} setIsOpen={setIsExportDialogOpen} />
    </>
  );
}
