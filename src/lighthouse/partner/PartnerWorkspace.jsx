import React from 'react';
import { StaffPortal } from '../../OrganizationPortal.jsx';

// Lighthouse owns the partner-facing entrypoint. North Star remains an implementation dependency,
// but the partner website is not rendered inside the North Star shell.
export default function PartnerWorkspace() {
  return <StaffPortal />;
}
