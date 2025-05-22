'use client';

import React, { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom'; // Hooks for URL params and navigation
import { 
  useOrganizationStore,
  // Import selectors from the main store export
  selectCurrentUserRoleInOrg,
  selectCurrentOrganizationId,
  selectCurrentOrganizationDetails,
  selectCurrentOrganizationMembers,
  // selectUserOrganizations, // Removed - Selector doesn't exist
} from '@paynless/store';
import { OrganizationDetailsCard } from '../components/organizations/OrganizationDetailsCard';
import { OrganizationPrivacyCard } from '../components/organizations/OrganizationPrivacyCard';
import { MemberListCard } from '../components/organizations/MemberListCard';
import { InviteMemberCard } from '../components/organizations/InviteMemberCard';
import { PendingActionsCard } from '../components/organizations/PendingActionsCard';
import { useCurrentUser } from '../hooks/useCurrentUser'; 
import { Skeleton } from '@/components/ui/skeleton';
import ErrorBoundary from '../components/common/ErrorBoundary';
import { logger } from '@paynless/utils'; // For logging errors/redirects
import { OrganizationChatSettings } from '../components/organizations/OrganizationChatSettings';
export const OrganizationFocusedViewPage: React.FC = () => {
  const { orgId } = useParams<{ orgId: string }>(); // Get orgId from URL
  const navigate = useNavigate();

  // Use imported selectors and direct state access where needed
  const userOrganizations = useOrganizationStore(state => state.userOrganizations); // Reverted to direct access
  const currentOrganizationId = useOrganizationStore(selectCurrentOrganizationId);
  const currentOrganizationDetails = useOrganizationStore(selectCurrentOrganizationDetails);
  const currentOrganizationMembers = useOrganizationStore(selectCurrentOrganizationMembers);
  const currentUserRole = useOrganizationStore(selectCurrentUserRoleInOrg);

  const { 
    setCurrentOrganizationId,
    isLoading: isOrgLoading,
    error: orgError,
    fetchUserOrganizations,
    fetchCurrentOrganizationDetails, // Destructure actions directly
    fetchCurrentOrganizationMembers, // Destructure actions directly
  } = useOrganizationStore((state) => ({ // Select actions and specific primitive states
    setCurrentOrganizationId: state.setCurrentOrganizationId,
    isLoading: state.isLoading,
    error: state.error,
    fetchUserOrganizations: state.fetchUserOrganizations,
    fetchCurrentOrganizationDetails: state.fetchCurrentOrganizationDetails,
    fetchCurrentOrganizationMembers: state.fetchCurrentOrganizationMembers,
  }));

  const { user } = useCurrentUser(); 
  // const currentUserRole = selectCurrentUserRoleInOrg(); // No longer call as a property

  useEffect(() => {
    // Ensure user organizations are loaded, especially on direct navigation
    if (user && userOrganizations.length === 0 && !isOrgLoading) {
      fetchUserOrganizations();
    }
  }, [user, userOrganizations, fetchUserOrganizations, isOrgLoading]);

  useEffect(() => {
    // Set the current org based on the URL parameter
    if (orgId && orgId !== currentOrganizationId) {
      logger.info(`[FocusedView] Setting current org ID from URL param: ${orgId}`);
      setCurrentOrganizationId(orgId);
    } else if (!orgId) {
        logger.warn('[FocusedView] No orgId found in URL params.');
        // Optional: redirect if no orgId is somehow possible?
        // navigate('/dashboard/organizations'); 
    }
  }, [orgId, currentOrganizationId, setCurrentOrganizationId]);

  useEffect(() => {
    // Fetch details and members whenever the currentOrganizationId is set (and matches orgId)
    // This handles both initial load via URL and changes via switcher (if applicable on this page)
    if (currentOrganizationId && currentOrganizationId === orgId) {
      logger.debug(`[FocusedView] Fetching details & members for orgId: ${currentOrganizationId}`);
      fetchCurrentOrganizationDetails(); // Call destructured action
      fetchCurrentOrganizationMembers(); // Call destructured action
    }
  }, [currentOrganizationId, orgId, fetchCurrentOrganizationDetails, fetchCurrentOrganizationMembers]); // Add actions to dependency array

  useEffect(() => {
    // Validation checks after data might have loaded based on orgId change
    if (!isOrgLoading && orgId && currentOrganizationId === orgId) {
        // Check 1: Is the requested orgId among the user's organizations?
        const orgExistsInUserList = userOrganizations.some(o => o.id === orgId);
        if (userOrganizations.length > 0 && !orgExistsInUserList) {
            logger.error(`[FocusedView] Org ID ${orgId} not found in user's organization list. Redirecting.`);
            navigate('/dashboard/organizations?error=not_found');
            return;
        }

        // Check 2: Is the organization soft-deleted?
        if (currentOrganizationDetails?.deleted_at) {
            logger.error(`[FocusedView] Organization ${orgId} is deleted. Redirecting.`);
            navigate('/dashboard/organizations?error=deleted');
            return;
        }

        // Check 3: Is the current user still an active member?
        if (currentOrganizationMembers.length > 0) {
             const isMember = currentOrganizationMembers.some(m => m.user_id === user?.id);
             if (!isMember) {
                logger.error(`[FocusedView] Current user ${user?.id} is not a member of org ${orgId}. Redirecting.`);
                navigate('/dashboard/organizations?error=not_member');
                return;
             }
        }
        
        // Check 4: Was there a general fetch error from the store?
        if (orgError) {
             logger.error(`[FocusedView] Store error encountered for org ${orgId}: ${orgError}. Redirecting.`);
             navigate('/dashboard/organizations?error=fetch_failed');
             return;
        }
    }
  }, [orgId, currentOrganizationId, userOrganizations, currentOrganizationDetails, currentOrganizationMembers, isOrgLoading, navigate, user?.id, orgError]);

  // Show loading state while initial data is being fetched for this org OR 
  // if the currentOrganizationId hasn't caught up to the orgId from the URL yet.
  if (isOrgLoading || currentOrganizationId !== orgId) {
    return (
      <div className="container mx-auto p-4">
        {/* Skeleton for Page Title */}
        <Skeleton className="h-8 w-1/2 mb-6" /> 
        <div className="space-y-6">
          {/* Skeletons mimicking the management cards layout */}
          <Skeleton className="h-32 w-full" /> {/* Details Card Skeleton */}
          <Skeleton className="h-24 w-full" /> {/* Settings/Invite Skeleton? (Estimate) */}
          <Skeleton className="h-48 w-full" /> {/* Member List Card Skeleton */}
          <Skeleton className="h-24 w-full" /> {/* Invite/Pending Skeleton? (Estimate) */}
          <Skeleton className="h-32 w-full" /> {/* Pending Actions Skeleton? (Estimate) */}
        </div>
      </div>
    );
  }

  // Check if org details failed to load specifically (redundant if orgError check works)
  // if (!currentOrganizationDetails && !isOrgLoading) {
  //   return (
  //       <div className="container mx-auto p-4">
  //           <h1 className="text-2xl font-semibold mb-6 text-destructive">Error</h1>
  //           <p>Failed to load organization details. It might not exist or you may not have access.</p>
  //           {/* Link back? */}
  //       </div>
  //   );
  // }

  const isAdmin = currentUserRole === 'admin';

  return (
    <div className="container mx-auto p-4">
      {/* Optionally display Org Name from currentOrganizationDetails if available */}
      <h1 className="text-2xl font-semibold mb-6 truncate">
        {currentOrganizationDetails?.name ?? 'Organization'}
      </h1>
      {/* Wrap the entire grid in an ErrorBoundary */}
      <ErrorBoundary fallback={<p>Could not load organization management cards.</p>}>
          {/* Use responsive grid for management cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <OrganizationDetailsCard />
              {isAdmin && (
                  <OrganizationPrivacyCard />
              )}
              <MemberListCard />
              {isAdmin && (
                  <InviteMemberCard />
              )}
              {isAdmin && (
                  <PendingActionsCard />
              )}
              {isAdmin && (
                  <OrganizationChatSettings />
              )}
          </div>
      </ErrorBoundary>
      {/* Render the Delete Dialog here */}
      {/* {isDeleteDialogOpen && <DeleteOrganizationDialog />} // REMOVED dialog rendering */}
    </div>
  );
}; 