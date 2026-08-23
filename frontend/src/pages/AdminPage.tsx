import { useCallback, useState } from 'react';
import { AdminIdentity } from '@/services/api';
import { SignInCard } from '@/pages/admin/SignInCard';
import { ChangePasswordCard } from '@/pages/admin/ChangePasswordCard';
import { TaskList } from '@/pages/admin/TaskList';

type View = 'signIn' | 'forcedPasswordChange' | 'passwordChange' | 'tasks';

/**
 * The whole admin area behind a single /admin route.
 *
 * Sign-in, the forced first-time password change and the task list are states of this
 * one page rather than separate URLs. For non-technical users that avoids being bounced
 * between addresses, and it means an expired session simply shows the sign-in card
 * again instead of navigating somewhere unfamiliar.
 */
export function AdminPage() {
    const [token, setToken] = useState(() => localStorage.getItem('adminToken'));
    const [username, setUsername] = useState(() => localStorage.getItem('adminUsername') ?? '');
    const [view, setView] = useState<View>(() => (localStorage.getItem('adminToken') ? 'tasks' : 'signIn'));

    const persist = useCallback((nextToken: string, admin: AdminIdentity) => {
        localStorage.setItem('adminToken', nextToken);
        localStorage.setItem('adminUsername', admin.username);
        setToken(nextToken);
        setUsername(admin.username);
    }, []);

    const signOut = useCallback(() => {
        localStorage.removeItem('adminToken');
        localStorage.removeItem('adminUsername');
        setToken(null);
        setUsername('');
        setView('signIn');
    }, []);

    if (!token || view === 'signIn') {
        return (
            <SignInCard
                onSignedIn={(nextToken, admin) => {
                    persist(nextToken, admin);
                    // An account still on its setup password has to replace it before
                    // the session is good for anything else.
                    setView(admin.mustChangePassword ? 'forcedPasswordChange' : 'tasks');
                }}
            />
        );
    }

    if (view === 'forcedPasswordChange' || view === 'passwordChange') {
        return (
            <ChangePasswordCard
                token={token}
                forced={view === 'forcedPasswordChange'}
                onDone={(nextToken, admin) => {
                    persist(nextToken, admin);
                    setView('tasks');
                }}
                onCancel={view === 'passwordChange' ? () => setView('tasks') : undefined}
                onSessionExpired={signOut}
            />
        );
    }

    return (
        <TaskList
            token={token}
            username={username}
            onChangePassword={() => setView('passwordChange')}
            onSignOut={signOut}
            onSessionExpired={signOut}
        />
    );
}
