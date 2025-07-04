import { create } from 'zustand';
import { api } from '@paynless/api';
import type { Notification, ApiError } from '@paynless/types';
import { logger } from '@paynless/utils';
import { useDialecticStore } from './dialecticStore';
import { useWalletStore } from './walletStore';

// Define state structure
export interface NotificationState {
    notifications: Notification[];
    unreadCount: number;
    isLoading: boolean;
    error: ApiError | null;
    // --- NEW: State for Realtime Subscription ---
    subscribedUserId: string | null;
    // -------------------------------------------
    fetchNotifications: () => Promise<void>;
    addNotification: (notification: Notification) => void; // For incoming Realtime updates
    markNotificationRead: (notificationId: string) => Promise<void>;
    markAllNotificationsAsRead: () => Promise<void>;
    // --- NEW: Actions for Realtime Subscription ---
    subscribeToUserNotifications: (userId: string) => void;
    unsubscribeFromUserNotifications: () => void;
    // --------------------------------------------
    // Exposed for testing, but considered internal
    handleIncomingNotification: (notification: Notification) => void;
}

// Helper function to calculate unread count
const calculateUnreadCount = (notifications: Notification[]): number => {
    return notifications.filter(n => !n.read).length;
};

// Helper function to sort notifications (newest first)
const sortNotifications = (notifications: Notification[]): Notification[] => {
    return [...notifications].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
};

export const useNotificationStore = create<NotificationState>((set, get) => {

    // --- NEW: Internal Realtime Callback Handler ---
    const handleIncomingNotification = (notification: Notification | null | undefined) => {
        if (!notification || typeof notification !== 'object' || !notification.id || !notification.user_id || !notification.type || !notification.created_at) {
            logger.warn('[NotificationStore] Received invalid notification data from subscription.', { payload: notification ?? 'undefined/null' });
            return;
        }
        logger.debug('[NotificationStore] Received notification via Realtime', { id: notification.id, type: notification.type });

        // --- NEW: Special handling for contribution generation ---
        if (notification.type === 'contribution_generation_complete') {
            const { data } = notification;
            if (data && typeof data === 'object' && 'sessionId' in data && 'projectId' in data) {
                logger.info('[NotificationStore] Handling contribution generation completion event.', { data });
                useDialecticStore.getState()._handleGenerationCompleteEvent?.({
                    sessionId: data['sessionId'] as string,
                    projectId: data['projectId'] as string,
                });
            } else {
                logger.warn('[NotificationStore] Received contribution_generation_complete event with invalid data.', { data });
            }
        }
        
        if (notification.type === 'WALLET_TRANSACTION') {
            const { data } = notification;
            if (data && typeof data === 'object' && 'walletId' in data && 'newBalance' in data) {
                logger.info('[NotificationStore] Handling wallet transaction event.', { data });
                useWalletStore.getState()._handleWalletUpdateNotification({
                    walletId: data['walletId'] as string,
                    newBalance: data['newBalance'] as string,
                });
            } else {
                logger.warn('[NotificationStore] Received WALLET_TRANSACTION event with invalid data.', { data });
            }
        }

        get().addNotification(notification as Notification);
    };
    // -------------------------------------------

    return {
        // Initial state
        notifications: [],
        unreadCount: 0,
        isLoading: false,
        error: null,
        // --- NEW: Realtime State ---
        subscribedUserId: null,
        // --------------------------
        handleIncomingNotification, // Exposed for testing

        // Actions
        fetchNotifications: async () => {
            if (!get().isLoading) {
                set({ isLoading: true, error: null });
            }
            try {
                const notificationApi = api.notifications();
                const response = await notificationApi.fetchNotifications();
                if (response.error) {
                    logger.error('[notificationStore] Failed to fetch notifications', { error: response.error });
                    set({ error: response.error, isLoading: false, notifications: [], unreadCount: 0 });
                } else {
                    const fetchedNotifications = response.data ?? [];
                    const sortedNotifications = sortNotifications(fetchedNotifications);
                    const unreadCount = calculateUnreadCount(sortedNotifications);
                    logger.info(`[notificationStore] Fetched ${sortedNotifications.length} notifications, ${unreadCount} unread.`);
                    set({
                        notifications: sortedNotifications,
                        unreadCount: unreadCount,
                        isLoading: false,
                        error: null,
                    });
                }
            } catch (error: unknown) {
                logger.error('[notificationStore] Error during initial load:', { 
                    error: error instanceof Error ? error.message : String(error) 
                });
                // Create ApiError object
                const apiError: ApiError = {
                    code: 'FETCH_FAILED',
                    message: error instanceof Error ? error.message : 'Failed to load notifications'
                };
                set({ isLoading: false, error: apiError });
            }
        },

        addNotification: (notification) => {
            set(state => {
                if (state.notifications.some(n => n.id === notification.id)) {
                    logger.warn('[notificationStore] Attempted to add duplicate notification', { id: notification.id });
                    return {};
                }
                logger.debug('[notificationStore] Added notification', { notificationId: notification.id });
                const newNotifications = sortNotifications([notification, ...state.notifications]);
                const newUnreadCount = calculateUnreadCount(newNotifications);
                return { notifications: newNotifications, unreadCount: newUnreadCount };
            });
        },

        markNotificationRead: async (notificationId) => {
            const currentNotifications = get().notifications;
            const notification = currentNotifications.find(n => n.id === notificationId);

            if (!notification) {
                logger.warn('[notificationStore] markNotificationRead: Notification not found', { notificationId });
                return;
            }
            if (notification.read) {
                logger.debug('[notificationStore] Notification already read', { notificationId });
                return;
            }

            set({ error: null });
            try {
                const notificationApi = api.notifications();
                const response = await notificationApi.markNotificationRead(notificationId);

                if (response.error) {
                    logger.error('[notificationStore] Failed to mark notification as read', { notificationId, error: response.error });
                    set({ error: response.error });
                } else {
                    logger.info('[notificationStore] Marked notification as read', { notificationId });
                    set(state => {
                        const updatedNotifications = state.notifications.map(n =>
                            n.id === notificationId ? { ...n, read: true } : n
                        );
                        const newUnreadCount = calculateUnreadCount(updatedNotifications);
                        return {
                            notifications: updatedNotifications,
                            unreadCount: newUnreadCount,
                            error: null
                        };
                    });
                }
            } catch (error: unknown) {
                logger.error(`Error marking notification ${notificationId} as read:`, { 
                    error: error instanceof Error ? error.message : String(error) 
                });
                // Create ApiError object
                const apiError: ApiError = {
                    code: 'MARK_READ_FAILED',
                    message: error instanceof Error ? error.message : 'Failed to mark notification as read'
                };
                set({ error: apiError });
            }
        },

        markAllNotificationsAsRead: async () => {
            if (get().unreadCount === 0) {
                logger.debug('No unread notifications to mark as read.');
                return;
            }

            set({ error: null });
            try {
                const notificationApi = api.notifications();
                const response = await notificationApi.markAllNotificationsAsRead();

                if (response.error) {
                    logger.error('[notificationStore] Failed to mark all notifications as read', { error: response.error });
                    set({ error: response.error });
                } else {
                    logger.info('[notificationStore] Marked all notifications as read');
                    set(state => ({
                        notifications: state.notifications.map(n => ({ ...n, read: true })),
                        unreadCount: 0,
                        error: null
                    }));
                }
            } catch (error: unknown) {
                logger.error('Error marking all notifications as read:', { 
                     error: error instanceof Error ? error.message : String(error) 
                });
                 // Create ApiError object
                 const apiError: ApiError = {
                    code: 'MARK_ALL_READ_FAILED',
                    message: error instanceof Error ? error.message : 'Failed to mark all notifications as read'
                 };
                 set({ error: apiError });
            }
        },

        // --- NEW: Realtime Actions Implementation ---
        subscribeToUserNotifications: (userId: string) => {
            if (!userId) {
                logger.error('User ID is required to subscribe to notifications.');
                return;
            }

            const currentSubscribedId = get().subscribedUserId;

            if (currentSubscribedId === userId) {
                logger.warn('[NotificationStore] Already subscribed to notifications for user:', { userId });
                return;
            }

            if (currentSubscribedId) {
                logger.info(`[NotificationStore] Switching subscription from user ${currentSubscribedId} to ${userId}`);
                get().unsubscribeFromUserNotifications();
            }

            logger.info('[NotificationStore] Subscribing to notifications for user:', { userId });
            try {
                const notificationApi = api.notifications();
                const channel = notificationApi.subscribeToNotifications(userId, get().handleIncomingNotification);

                if (channel) {
                    set({ subscribedUserId: userId, error: null });
                    logger.info('[NotificationStore] Successfully subscribed to notification channel for user:', { userId });
                } else {
                    logger.error('[NotificationStore] Failed to subscribe to notifications, API returned null channel for user:', { userId });
                    set({ subscribedUserId: null });
                }
            } catch (error: unknown) {
                logger.error('[NotificationStore] Error calling subscribeToNotifications:', { 
                    userId, 
                    error: error instanceof Error ? error.message : String(error) 
                });
                set({ subscribedUserId: null, error: { code: 'SUBSCRIBE_ERROR', message: error instanceof Error ? error.message : String(error) } });
            }
        },

        unsubscribeFromUserNotifications: () => {
            const currentSubscribedId = get().subscribedUserId;
            if (!currentSubscribedId) {
                logger.debug('Not currently subscribed to notifications, skipping unsubscribe.');
                return;
            }

            logger.info('Unsubscribing from notifications.');
            try {
                const notificationApi = api.notifications();
                notificationApi.unsubscribeFromNotifications();
                set({ subscribedUserId: null });
                logger.info('Successfully unsubscribed from notifications for user:', { userId: currentSubscribedId });
            } catch (error: unknown) {
                logger.error('[NotificationStore] Error calling unsubscribeFromNotifications:', { 
                    userId: currentSubscribedId, 
                    error: error instanceof Error ? error.message : String(error) 
                });
                set({ subscribedUserId: null, error: { code: 'UNSUBSCRIBE_ERROR', message: error instanceof Error ? error.message : String(error) } });
            }
        },
        // -----------------------------------------
    }
}); 