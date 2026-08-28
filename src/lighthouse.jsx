import React from 'react';
import { createRoot } from 'react-dom/client';
import OrganizationPortal from './OrganizationPortal.jsx';
import PartnerWorkspace from './lighthouse/partner/PartnerWorkspace.jsx';
import './styles.css';
import './theme.css';
import './organization.css';

function LighthouseApp() {
  const partner = window.location.pathname.includes('partner');
  return partner ? <PartnerWorkspace /> : <OrganizationPortal participant />;
}

createRoot(document.getElementById('root')).render(<LighthouseApp />);
