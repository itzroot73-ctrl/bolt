/**
 * LocalStorage utilities for chat persistence
 * Provides fallback storage when IndexedDB is unavailable
 */

import type { Message } from 'ai';
import type { ChatHistoryItem } from './useChatHistory';

// Client-side storage utilities
const isClient = typeof window !== 'undefined' && typeof localStorage !== 'undefined';

export function getLocalStorage(key: string): any | null {
  if (!isClient) {
    return null;
  }

  try {
    const item = localStorage.getItem(key);
    return item ? JSON.parse(item) : null;
  } catch (error) {
    console.error(`Error reading from localStorage key "${key}":`, error);
    return null;
  }
}

export function setLocalStorage(key: string, value: any): void {
  if (!isClient) {
    return;
  }

  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.error(`Error writing to localStorage key "${key}":`, error);
  }
}

export interface LocalStorageChat {
  id: string;
  urlId?: string;
  description?: string;
  messages: Message[];
  timestamp: string;
  metadata?: any;
}

const CHAT_STORAGE_KEY = 'bolt-chats';
const CURRENT_CHAT_KEY = 'bolt-current-chat';

/**
 * Check if LocalStorage is available
 */
export function isLocalStorageAvailable(): boolean {
  try {
    const test = 'test';
    localStorage.setItem(test, test);
    localStorage.removeItem(test);
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Get all chats from LocalStorage
 */
export function getAllChatsFromLocalStorage(): LocalStorageChat[] {
  if (!isLocalStorageAvailable()) {
    console.warn('LocalStorage is not available');
    return [];
  }

  try {
    const stored = localStorage.getItem(CHAT_STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch (error) {
    console.error('Error reading chats from LocalStorage:', error);
    return [];
  }
}

/**
 * Save a chat to LocalStorage
 */
export function saveChatToLocalStorage(chat: LocalStorageChat): void {
  if (!isLocalStorageAvailable()) {
    console.warn('LocalStorage is not available');
    return;
  }

  try {
    const chats = getAllChatsFromLocalStorage();
    const existingIndex = chats.findIndex(c => c.id === chat.id);
    
    if (existingIndex >= 0) {
      chats[existingIndex] = chat;
    } else {
      chats.push(chat);
    }
    
    localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(chats));
  } catch (error) {
    console.error('Error saving chat to LocalStorage:', error);
  }
}

/**
 * Delete a chat from LocalStorage
 */
export function deleteChatFromLocalStorage(id: string): void {
  if (!isLocalStorageAvailable()) {
    console.warn('LocalStorage is not available');
    return;
  }

  try {
    const chats = getAllChatsFromLocalStorage();
    const filteredChats = chats.filter(c => c.id !== id);
    localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(filteredChats));
  } catch (error) {
    console.error('Error deleting chat from LocalStorage:', error);
  }
}

/**
 * Get a specific chat by ID from LocalStorage
 */
export function getChatFromLocalStorage(id: string): LocalStorageChat | null {
  if (!isLocalStorageAvailable()) {
    return null;
  }

  const chats = getAllChatsFromLocalStorage();
  return chats.find(c => c.id === id) || null;
}

/**
 * Save current chat ID to LocalStorage
 */
export function setCurrentChatId(id: string | undefined): void {
  if (!isLocalStorageAvailable()) {
    return;
  }

  try {
    if (id) {
      localStorage.setItem(CURRENT_CHAT_KEY, id);
    } else {
      localStorage.removeItem(CURRENT_CHAT_KEY);
    }
  } catch (error) {
    console.error('Error setting current chat ID:', error);
  }
}

/**
 * Get current chat ID from LocalStorage
 */
export function getCurrentChatId(): string | null {
  if (!isLocalStorageAvailable()) {
    return null;
  }

  try {
    return localStorage.getItem(CURRENT_CHAT_KEY);
  } catch (error) {
    console.error('Error getting current chat ID:', error);
    return null;
  }
}

/**
 * Clear all chat data from LocalStorage
 */
export function clearLocalStorageChats(): void {
  if (!isLocalStorageAvailable()) {
    return;
  }

  try {
    localStorage.removeItem(CHAT_STORAGE_KEY);
    localStorage.removeItem(CURRENT_CHAT_KEY);
  } catch (error) {
    console.error('Error clearing LocalStorage chats:', error);
  }
}

/**
 * Convert ChatHistoryItem to LocalStorageChat
 */
export function convertToLocalStorageChat(item: ChatHistoryItem): LocalStorageChat {
  return {
    id: item.id,
    urlId: item.urlId,
    description: item.description,
    messages: item.messages,
    timestamp: item.timestamp,
    metadata: item.metadata
  };
}

/**
 * Convert LocalStorageChat to ChatHistoryItem
 */
export function convertToChatHistoryItem(item: LocalStorageChat): ChatHistoryItem {
  return {
    id: item.id,
    urlId: item.urlId,
    description: item.description,
    messages: item.messages,
    timestamp: item.timestamp,
    metadata: item.metadata
  };
}
