import React, { Suspense, lazy } from 'react';
import { createBrowserRouter, Navigate, useLocation } from 'react-router-dom';
import AppLayout from '../components/Layout';
import { useAuth } from '../contexts/AuthContext';
import { OwnerProvider } from '../contexts/OwnerContext';
import { Spin } from 'antd';

// 关键页面（首屏立即加载）
import Login from '../pages/Login/index';
import Dashboard from '../pages/Dashboard';

// 按需加载（lazy load）
const PositionsList = lazy(() => import('../pages/Positions/List'));
const PositionForm = lazy(() => import('../pages/Positions/Form'));
const ResumesList = lazy(() => import('../pages/Resumes/List'));
const ResumeUpload = lazy(() => import('../pages/Resumes/Upload'));
const ResumeDetail = lazy(() => import('../pages/Resumes/Detail'));
const InterviewsList = lazy(() => import('../pages/Interviews/List'));
const InterviewScore = lazy(() => import('../pages/Interviews/Score'));
const InterviewResultPage = lazy(() => import('../pages/Interviews/Result'));
const PublicJobDetail = lazy(() => import('../pages/Public/JobDetail'));
const PublicReview = lazy(() => import('../pages/Public/Review'));
const BusinessScreening = lazy(() => import('../pages/Public/BusinessScreening'));
const InterviewCard = lazy(() => import('../pages/Public/InterviewCard'));
const SharedDashboard = lazy(() => import('../pages/SharedDashboard'));
const UsersList = lazy(() => import('../pages/Settings/Users'));
const ProfileSettings = lazy(() => import('../pages/Settings/Profile'));
const SystemSettingsPage = lazy(() => import('../pages/Settings/System'));
const MailSettings = lazy(() => import('../pages/Settings/Mail'));
const RequisitionsList = lazy(() => import('../pages/Requisitions/List'));
const OnboardingList = lazy(() => import('../pages/Onboarding/List'));
const ProbationList = lazy(() => import('../pages/Probation/List'));
const DailyReportsList = lazy(() => import('../pages/DailyReports/List'));
const JDManagementList = lazy(() => import('../pages/JDManagement/List'));
const JDManagementEditor = lazy(() => import('../pages/JDManagement/Editor'));
const PositionMappings = lazy(() => import('../pages/Settings/PositionMappings'));
const InterviewerMappings = lazy(() => import('../pages/Settings/InterviewerMappings'));
const TalentPoolList = lazy(() => import('../pages/TalentPool/List'));
const NotFound = lazy(() => import('../pages/NotFound'));
const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { isAuthenticated, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}><Spin size="large" /></div>;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  return <>{children}</>;
};

/** 路由级角色守卫 */
const RoleRoute = ({ children, roles }: { children: React.ReactNode; roles: string[] }) => {
  const { user } = useAuth();
  const userRole = (user as any)?.role?.value ?? (user as any)?.role;
  if (!roles.includes(userRole)) {
    return <Navigate to="/dashboard" replace />;
  }
  return <>{children}</>;
};
const LazyPage = ({ children }: { children: React.ReactNode }) => (
  <Suspense fallback={
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh' }}>
      <Spin size="large" description="加载中..." />
    </div>
  }>
    {children}
  </Suspense>
);

const OAuthCallback = lazy(() => import('../pages/OAuthCallback'));

const router = createBrowserRouter([
  // 公开路由（无需登录）
  {
    path: '/oauth/callback',
    element: <LazyPage><OAuthCallback /></LazyPage>,
  },
  {
    path: '/login',
    element: <Login />,
  },
  {
    path: '/public/jobs/:id',
    element: <LazyPage><PublicJobDetail /></LazyPage>,
  },
  {
    path: '/public/review/:resumeId/:reviewerId',
    element: <LazyPage><PublicReview /></LazyPage>,
  },
  {
    path: '/business-screening/:token',
    element: <LazyPage><BusinessScreening /></LazyPage>,
  },
  {
    path: '/interview-card/:token',
    element: <LazyPage><InterviewCard /></LazyPage>,
  },
  {
    path: '/shared/dashboard/:token',
    element: <LazyPage><SharedDashboard /></LazyPage>,
  },
  {
    path: '/',
    element: (
      <ProtectedRoute>
        <OwnerProvider>
          <AppLayout />
        </OwnerProvider>
      </ProtectedRoute>
    ),
    children: [
      {
        path: '/',
        element: <Navigate to="/dashboard" replace />,
      },
      {
        path: 'dashboard',
        element: <Dashboard />,
      },
      {
        path: 'positions',
        element: <LazyPage><PositionsList /></LazyPage>,
      },
      {
        path: 'positions/new',
        element: <LazyPage><PositionForm /></LazyPage>,
      },
      {
        path: 'positions/:id',
        element: <LazyPage><PositionForm /></LazyPage>,
      },
      {
        path: 'resumes',
        element: <LazyPage><ResumesList /></LazyPage>,
      },
      {
        path: 'resumes/new',
        element: <LazyPage><ResumeUpload /></LazyPage>,
      },
      {
        path: 'resumes/:id',
        element: <LazyPage><ResumeDetail /></LazyPage>,
      },
      {
        path: 'interviews',
        element: <LazyPage><InterviewsList /></LazyPage>,
      },
      {
        path: 'interviews/:id',
        element: <LazyPage><InterviewScore /></LazyPage>,
      },
      {
        path: 'interviews/:id/result',
        element: <LazyPage><InterviewResultPage /></LazyPage>,
      },
      {
        path: 'interviews/:id/score',
        element: <LazyPage><InterviewScore /></LazyPage>,
      },
      {
        path: 'users',
        element: <RoleRoute roles={['admin']}><LazyPage><UsersList /></LazyPage></RoleRoute>,
      },
      {
        path: 'settings/profile',
        element: <LazyPage><ProfileSettings /></LazyPage>,
      },
      {
        path: 'settings/system',
        element: <RoleRoute roles={['admin']}><LazyPage><SystemSettingsPage /></LazyPage></RoleRoute>,
      },
      {
        path: 'settings/position-mappings',
        element: <RoleRoute roles={['admin']}><LazyPage><PositionMappings /></LazyPage></RoleRoute>,
      },
      {
        path: 'settings/interviewer-mappings',
        element: <RoleRoute roles={['admin']}><LazyPage><InterviewerMappings /></LazyPage></RoleRoute>,
      },
      {
        path: 'settings/mail',
        element: <RoleRoute roles={['admin']}><LazyPage><MailSettings /></LazyPage></RoleRoute>,
      },
      {
        path: 'requisitions',
        element: <LazyPage><RequisitionsList /></LazyPage>,
      },
      {
        path: 'onboarding',
        element: <LazyPage><OnboardingList /></LazyPage>,
      },
      {
        path: 'probation',
        element: <LazyPage><ProbationList /></LazyPage>,
      },
      {
        path: 'jd-management',
        element: <LazyPage><JDManagementList /></LazyPage>,
      },
      {
        path: 'jd-management/:id',
        element: <LazyPage><JDManagementEditor /></LazyPage>,
      },
      {
        path: 'daily-reports',
        element: <LazyPage><DailyReportsList /></LazyPage>,
      },
      {
        path: 'talent-pool',
        element: <LazyPage><TalentPoolList /></LazyPage>,
      },
    ],
  },
  { path: '*', element: <LazyPage><NotFound /></LazyPage> },
]);

export default router;
