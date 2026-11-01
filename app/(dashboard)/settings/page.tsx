'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAuth } from '@/components/auth-provider';
import { useRouter } from 'next/navigation';
import { getSupabaseBrowserClient } from '@/lib/supabase-browser';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { ArrowLeft, Loader2, Eye, EyeOff } from 'lucide-react';

export default function AccountSettingsPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const { toast } = useToast();
  
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [updating, setUpdating] = useState(false);
  const [showPasswordDialog, setShowPasswordDialog] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [userProfile, setUserProfile] = useState<{ display_name?: string } | null>(null);

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace('/signin');
    } else if (user) {
      setEmail(user.email || '');
      fetchUserProfile();
    }
  }, [authLoading, user, router]);

  async function fetchUserProfile() {
    const supabase = getSupabaseBrowserClient();
    const { data, error } = await supabase
      .from('auth.users')
      .select('raw_user_meta_data')
      .eq('id', user?.id)
      .maybeSingle();
    
    if (!error && data) {
      const profile = data.raw_user_meta_data || {};
      setDisplayName(profile.display_name || user?.email?.split('@')[0] || '');
      setUserProfile(profile);
    } else {
      setDisplayName(user?.email?.split('@')[0] || '');
    }
  }

  async function handleUpdateProfile(e: React.FormEvent) {
    e.preventDefault();
    if (!displayName.trim()) {
      toast({ title: 'Display name required', variant: 'destructive' });
      return;
    }

    setUpdating(true);
    const supabase = getSupabaseBrowserClient();
    
    try {
      const { error } = await supabase.auth.updateUser({
        data: { display_name: displayName.trim() },
      });

      if (error) {
        toast({ title: 'Update failed', description: error.message, variant: 'destructive' });
      } else {
        toast({ title: 'Profile updated', description: 'Your display name has been saved.' });
        setUserProfile({ display_name: displayName.trim() });
      }
    } finally {
      setUpdating(false);
    }
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    
    if (newPassword.length < 8) {
      toast({ title: 'Password too short', description: 'Password must be at least 8 characters.', variant: 'destructive' });
      return;
    }

    if (newPassword !== confirmPassword) {
      toast({ title: 'Passwords do not match', variant: 'destructive' });
      return;
    }

    setChangingPassword(true);
    const supabase = getSupabaseBrowserClient();

    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (error) {
        toast({ title: 'Password change failed', description: error.message, variant: 'destructive' });
      } else {
        toast({ title: 'Password changed', description: 'Your password has been updated successfully.' });
        setShowPasswordDialog(false);
        setNewPassword('');
        setConfirmPassword('');
      }
    } finally {
      setChangingPassword(false);
    }
  }

  if (authLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/dashboard">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </Link>
        <h1 className="text-3xl font-bold">Account Settings</h1>
      </div>

      <div className="grid gap-6 max-w-2xl">
        {/* Profile Section */}
        <div className="rounded-lg border bg-background p-6">
          <h2 className="text-lg font-semibold mb-4">Profile</h2>
          <form onSubmit={handleUpdateProfile} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                disabled
                className="bg-muted"
              />
              <p className="text-xs text-muted-foreground">Email cannot be changed</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="display-name">Display Name</Label>
              <Input
                id="display-name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Your name"
                maxLength={80}
              />
              <p className="text-xs text-muted-foreground">This is how you'll appear in workspaces and messages</p>
            </div>

            <div className="flex justify-end pt-2">
              <Button type="submit" disabled={updating || !displayName.trim()}>
                {updating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Save Changes
              </Button>
            </div>
          </form>
        </div>

        {/* Security Section */}
        <div className="rounded-lg border bg-background p-6">
          <h2 className="text-lg font-semibold mb-4">Security</h2>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-sm">Password</p>
                <p className="text-xs text-muted-foreground">Last changed never</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowPasswordDialog(true)}
              >
                Change Password
              </Button>
            </div>
          </div>
        </div>

        {/* Account Info Section */}
        <div className="rounded-lg border bg-background p-6">
          <h2 className="text-lg font-semibold mb-4">Account Information</h2>
          <div className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Account ID</span>
              <code className="bg-muted px-2 py-1 rounded text-xs font-mono">{user.id}</code>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Account created</span>
              <span>{user.created_at ? new Date(user.created_at).toLocaleDateString() : 'N/A'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Last sign in</span>
              <span>{user.last_sign_in_at ? new Date(user.last_sign_in_at).toLocaleDateString() : 'N/A'}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Change Password Dialog */}
      <Dialog open={showPasswordDialog} onOpenChange={setShowPasswordDialog}>
        <DialogContent className="max-w-md">
          <form onSubmit={handleChangePassword}>
            <DialogHeader>
              <DialogTitle>Change Password</DialogTitle>
              <DialogDescription>
                Enter a new password for your account. Minimum 8 characters.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="new-password">New Password</Label>
                <div className="relative">
                  <Input
                    id="new-password"
                    type={showPassword ? 'text' : 'password'}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="At least 8 characters"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirm-password">Confirm Password</Label>
                <Input
                  id="confirm-password"
                  type={showPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter password"
                  required
                />
              </div>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowPasswordDialog(false)}
                disabled={changingPassword}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={changingPassword || !newPassword.trim()}>
                {changingPassword && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Change Password
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
