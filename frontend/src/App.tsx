import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { TaskEntry } from '@/pages/TaskEntry';
import { TaskField } from '@/pages/TaskField';
import { AdminPage } from '@/pages/AdminPage';

export function App() {
    return (
        <BrowserRouter>
            <Routes>
                <Route path="/" element={<TaskEntry />} />
                <Route path="/task/:taskId" element={<TaskField />} />

                {/* One route for the whole admin area. Sign-in, the first-time password
                    change and the task list are states of this page, not separate URLs,
                    so nobody gets bounced between addresses. */}
                <Route path="/admin" element={<AdminPage />} />

                {/* Old bookmarks from the previous separate-route version. */}
                <Route path="/admin/login" element={<Navigate to="/admin" replace />} />
                <Route path="/admin/password" element={<Navigate to="/admin" replace />} />
                <Route path="/admin/change-password" element={<Navigate to="/admin" replace />} />

                <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
        </BrowserRouter>
    );
}
