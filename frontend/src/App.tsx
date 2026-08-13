import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { TaskEntry } from './pages/TaskEntry';
import { TaskField } from './pages/TaskField';
import { AdminLogin } from './pages/AdminLogin';
import { AdminDashboard } from './pages/AdminDashboard';

export function App() {
    return (
        <BrowserRouter>
            <Routes>
                <Route path="/" element={<TaskEntry />} />
                <Route path="/task/:taskId" element={<TaskField />} />
                <Route path="/admin/login" element={<AdminLogin />} />
                <Route path="/admin" element={<AdminDashboard />} />
            </Routes>
        </BrowserRouter>
    );
}
