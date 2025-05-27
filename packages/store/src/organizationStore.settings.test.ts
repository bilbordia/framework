import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { useOrganizationStore } from './organizationStore';
import { useAuthStore } from './authStore';
import { act } from '@testing-library/react';
import { Organization, UserProfile, OrganizationStoreType, OrganizationMember, OrganizationMemberWithProfile, User } from '@paynless/types';
import { getApiClient } from '@paynless/api';
import { 
    selectCanCreateOrganizationChats,
    selectCurrentUserRoleInOrg 
} from './organizationStore.selectors';

// --- Mocks ---
// This mock factory is hoisted. It should not reference module-level variables 
// defined with const/let that are initialized later in the file.
vi.mock('@paynless/api', async () => {
    const actual = await vi.importActual<typeof import('@paynless/api')>('@paynless/api');
    return {
        ...actual,
        // getApiClient will be a mock function that returns an object with further mock functions
        getApiClient: vi.fn().mockReturnValue({
            organizations: {
                getOrganizationDetails: vi.fn(),
                updateOrganization: vi.fn(),
                updateOrganizationSettings: vi.fn(),
            },
        }),
    };
});

vi.mock('./authStore');
vi.mock('./analyticsStore'); 

const mockTrackEvent = vi.fn();

// --- Test State Setup ---
const testOrgId = 'org-settings-test-123';
const mockUser: UserProfile = { 
    id: 'user-settings-test', 
    created_at: 't', 
    updated_at: 't',
    first_name: null,
    last_name: null,
    last_selected_org_id: null,
    role: 'user',
    chat_context: {},
    profile_privacy_setting: 'public'
};

const initialTestOrgState: Partial<OrganizationStoreType> = {
    currentOrganizationId: testOrgId,
    currentOrganizationDetails: null, 
    isLoading: false,
    error: null,
    userOrganizations: [],
    currentOrganizationMembers: [],
    memberCurrentPage: 1,
    memberPageSize: 10,
    memberTotalCount: 0,
    currentPendingInvites: [], 
    currentPendingRequests: [], 
    currentInviteDetails: null,
    isFetchingInviteDetails: false,
    fetchInviteDetailsError: null,
    isCreateModalOpen: false,
    isDeleteDialogOpen: false,
    orgListPage: 1,
    orgListPageSize: 10,
    orgListTotalCount: 0,
};

const resetOrganizationStore = (initialState: Partial<OrganizationStoreType> = {}) => {
    act(() => {
        useOrganizationStore.setState({
            ...initialTestOrgState,
            ...initialState,
        } as OrganizationStoreType, false); 
    });
};

describe('Organization Store - Chat Settings', () => {
    // Hold references to the mock functions obtained from the mocked getApiClient
    let mockedGetOrganizationDetails: Mock;
    let mockedUpdateOrganization: Mock;
    let mockedUpdateOrganizationSettings: Mock;

    beforeEach(() => {
        resetOrganizationStore();
        
        const apiClient = getApiClient();
        mockedGetOrganizationDetails = apiClient.organizations.getOrganizationDetails as Mock;
        mockedUpdateOrganization = apiClient.organizations.updateOrganization as Mock;
        mockedUpdateOrganizationSettings = apiClient.organizations.updateOrganizationSettings as Mock;

        vi.clearAllMocks(); 

        mockedGetOrganizationDetails.mockReset();
        mockedUpdateOrganization.mockReset();
        mockedUpdateOrganizationSettings.mockReset();
        mockTrackEvent.mockReset();

        (useAuthStore.getState as Mock).mockReturnValue({ 
            user: mockUser,
            session: { access_token: 'test-token', expires_at: Date.now() + 360000, user: mockUser, expires_in: 3600 } as any,
            navigate: vi.fn(), 
        } as any);
    });

    describe('fetchCurrentOrganizationDetails', () => {
        it('should load organization details including allow_member_chat_creation', async () => {
            const mockOrgDetails: Organization = {
                id: testOrgId,
                name: 'Test Settings Org',
                created_at: 't',
                visibility: 'private',
                deleted_at: null,
                allow_member_chat_creation: true,
                token_usage_policy: 'member_tokens'
            };
            mockedGetOrganizationDetails.mockResolvedValue({ data: mockOrgDetails, error: undefined, status: 200 });

            await act(async () => {
                await useOrganizationStore.getState().fetchCurrentOrganizationDetails();
            });

            expect(mockedGetOrganizationDetails).toHaveBeenCalledWith(testOrgId);
            const state = useOrganizationStore.getState();
            expect(state.currentOrganizationDetails).toEqual(mockOrgDetails);
            expect(state.currentOrganizationDetails?.allow_member_chat_creation).toBe(true);
            expect(state.isLoading).toBe(false);
            expect(state.error).toBeNull();
        });
    });

    describe('updateOrganizationSettings', () => {
        it('should call API (updateOrganizationSettings), update state, and track event on successful update', async () => {
            const initialOrgDetails: Organization = {
                id: testOrgId,
                name: 'Test Settings Org Update',
                created_at: 't',
                visibility: 'private',
                deleted_at: null,
                allow_member_chat_creation: false,
                token_usage_policy: 'member_tokens'
            };
            resetOrganizationStore({ currentOrganizationDetails: initialOrgDetails, userOrganizations: [initialOrgDetails] });

            const newSettings = { allow_member_chat_creation: true, token_usage_policy: 'organization_tokens' as const };
            const updatedApiResponseOrg = { ...initialOrgDetails, ...newSettings };
            
            mockedUpdateOrganizationSettings.mockResolvedValue({ data: updatedApiResponseOrg, error: undefined, status: 200 });

            let result: boolean | undefined;
            await act(async () => {
                result = await useOrganizationStore.getState().updateOrganizationSettings(testOrgId, newSettings);
            });

            expect(result).toBe(true);
            expect(mockedUpdateOrganizationSettings).toHaveBeenCalledWith(testOrgId, newSettings);
            const state = useOrganizationStore.getState();
            expect(state.currentOrganizationDetails?.allow_member_chat_creation).toBe(true);
            expect(state.currentOrganizationDetails?.token_usage_policy).toBe('organization_tokens');
            expect(state.currentOrganizationDetails?.name).toBe(initialOrgDetails.name);
            expect(state.userOrganizations.find(o => o.id === testOrgId)?.allow_member_chat_creation).toBe(true);
            expect(state.userOrganizations.find(o => o.id === testOrgId)?.token_usage_policy).toBe('organization_tokens');
            expect(state.isLoading).toBe(false);
            expect(state.error).toBeNull();
        });

        it('should set error state and return false on API (updateOrganizationSettings) failure', async () => {
            const initialOrgDetails: Organization = {
                id: testOrgId,
                name: 'Test Settings Org Fail',
                created_at: 't',
                visibility: 'private',
                deleted_at: null,
                allow_member_chat_creation: true,
                token_usage_policy: 'member_tokens'
            };
            resetOrganizationStore({ currentOrganizationDetails: initialOrgDetails });

            const newSettings = { allow_member_chat_creation: false, token_usage_policy: 'organization_tokens' as const };
            const apiError = { message: 'Update failed', code: 'API_ERROR' };
            
            mockedUpdateOrganizationSettings.mockResolvedValue({ data: undefined, error: apiError, status: 500 });

            let result: boolean | undefined;
            await act(async () => {
                result = await useOrganizationStore.getState().updateOrganizationSettings(testOrgId, newSettings);
            });

            expect(result).toBe(false);
            expect(mockedUpdateOrganizationSettings).toHaveBeenCalledWith(testOrgId, newSettings);
            const state = useOrganizationStore.getState();
            expect(state.currentOrganizationDetails?.allow_member_chat_creation).toBe(true);
            expect(state.currentOrganizationDetails?.token_usage_policy).toBe('member_tokens');
            expect(state.isLoading).toBe(false);
            expect(state.error).toBe(apiError.message);
        });
    });

    describe('selectCanCreateOrganizationChats', () => {
        const orgId = 'org-test-settings';

        // Corrected UserProfile mocks based on actual DB schema
        const memberUserProfile: UserProfile = { 
            id: 'member-user-id', 
            first_name: 'Member', 
            last_name: 'User', 
            role: 'user', // Role is directly on UserProfile
            created_at: '2023-01-01T00:00:00Z',
            updated_at: '2023-01-01T00:00:00Z',
            last_selected_org_id: null,
            chat_context: {},
            profile_privacy_setting: 'public'
            // Removed: display_name, avatar_url, bio
        };
        const adminUserProfile: UserProfile = { 
            id: 'admin-user-id', 
            first_name: 'Admin', 
            last_name: 'User',
            role: 'admin', // Role is directly on UserProfile
            created_at: '2023-01-01T00:00:00Z',
            updated_at: '2023-01-01T00:00:00Z',
            last_selected_org_id: orgId,
            chat_context: {},
            profile_privacy_setting: 'public'
            // Removed: display_name, avatar_url, bio
        };

        // Mocks for the User type (used by useAuthStore.getState().user)
        // The User type only needs id, email, role based on auth.types.ts
        const authMemberUser: User = { id: memberUserProfile.id, email: 'member@example.com', role: 'user' };
        const authAdminUser: User = { id: adminUserProfile.id, email: 'admin@example.com', role: 'admin' }; 

        const members: OrganizationMemberWithProfile[] = [
            { 
                id: 'mem-admin', user_id: adminUserProfile.id, organization_id: orgId, role: 'admin', created_at: '2023-01-01T00:00:00Z', status: 'active',
                user_profiles: adminUserProfile // Use the corrected profile mock
            },
            { 
                id: 'mem-member', user_id: memberUserProfile.id, organization_id: orgId, role: 'member', created_at: '2023-01-01T00:00:00Z', status: 'active',
                user_profiles: memberUserProfile // Use the corrected profile mock
            },
        ];

        it('should return true if setting is true (admin role)', () => {
            // Setup state for admin role
            (useAuthStore.getState as Mock).mockReturnValue({ user: authAdminUser, session: {} } as any);
            const state = { 
                ...initialTestOrgState, 
                currentOrganizationId: orgId,
                currentOrganizationMembers: members,
                currentOrganizationDetails: { allow_member_chat_creation: true } as any
            } as OrganizationStoreType;
            expect(selectCanCreateOrganizationChats(state)).toBe(true);
        });

        it('should return true if setting is true (member role)', () => {
            // Setup state for member role
            (useAuthStore.getState as Mock).mockReturnValue({ user: authMemberUser, session: {} } as any);
            const state = { 
                ...initialTestOrgState, 
                currentOrganizationId: orgId,
                currentOrganizationMembers: members,
                currentOrganizationDetails: { allow_member_chat_creation: true } as any
            } as OrganizationStoreType;
            expect(selectCanCreateOrganizationChats(state)).toBe(true);
        });

        it('should return false if setting is false (admin role)', () => {
            (useAuthStore.getState as Mock).mockReturnValue({ user: authAdminUser, session: {} } as any);
            const state = { 
                ...initialTestOrgState, 
                currentOrganizationId: orgId,
                currentOrganizationMembers: members,
                currentOrganizationDetails: { allow_member_chat_creation: false } as any
            } as OrganizationStoreType;
            expect(selectCanCreateOrganizationChats(state)).toBe(false);
        });

        it('should return false if setting is false (member role)', () => {
            (useAuthStore.getState as Mock).mockReturnValue({ user: authMemberUser, session: {} } as any);
            const state = { 
                ...initialTestOrgState, 
                currentOrganizationId: orgId,
                currentOrganizationMembers: members,
                currentOrganizationDetails: { allow_member_chat_creation: false } as any
            } as OrganizationStoreType;
            expect(selectCanCreateOrganizationChats(state)).toBe(false);
        });

        it('should return false if setting is null or undefined', () => {
            (useAuthStore.getState as Mock).mockReturnValue({ user: authMemberUser, session: {} } as any);
            let state = { 
                ...initialTestOrgState, 
                currentOrganizationId: orgId,
                currentOrganizationMembers: members,
                currentOrganizationDetails: { allow_member_chat_creation: null } as any
            } as OrganizationStoreType;
            expect(selectCanCreateOrganizationChats(state)).toBe(false);
            
            state = { 
                ...initialTestOrgState, 
                currentOrganizationId: orgId,
                currentOrganizationMembers: members,
                currentOrganizationDetails: {} as any
            } as OrganizationStoreType;
            expect(selectCanCreateOrganizationChats(state)).toBe(false);
        });
        
        it('should return false if organization settings are null', () => {
            (useAuthStore.getState as Mock).mockReturnValue({ user: authMemberUser, session: {} } as any);
            const state = { 
                ...initialTestOrgState, 
                currentOrganizationId: orgId,
                currentOrganizationMembers: members,
                currentOrganizationDetails: null
            } as OrganizationStoreType;
            expect(selectCanCreateOrganizationChats(state)).toBe(false);
        });
    });
});