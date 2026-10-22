import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import {AuthCallback} from './useAuth';
import './styles.css';
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode>{window.location.pathname==='/auth/callback'?<AuthCallback/>:<App/>}</React.StrictMode>);
