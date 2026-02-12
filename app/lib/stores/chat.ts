import { map } from 'nanostores';
import { setCurrentChatId, getCurrentChatId, saveChatToLocalStorage, getAllChatsFromLocalStorage, type LocalStorageChat } from '~/lib/persistence/localStorage';
import type { Message } from 'ai';

export interface ChatState {
  started: boolean;
  aborted: boolean;
  showChat: boolean;
  currentChatId?: string;
  messages: Message[];
}

export const chatStore = map<ChatState>({
  started: false,
  aborted: false,
  showChat: true,
  currentChatId: undefined,
  messages: [],
});

/**
 * Set current chat ID and sync with LocalStorage
 */
export function setCurrentChat(id: string | undefined): void {
  chatStore.setKey('currentChatId', id);
  setCurrentChatId(id);
}

/**
 * Initialize chat store from LocalStorage
 */
export function initializeChatStore(): void {
  const currentChatId = getCurrentChatId();
  if (currentChatId) {
    chatStore.setKey('currentChatId', currentChatId);
    
    // Load messages from LocalStorage if available
    const chats = getAllChatsFromLocalStorage();
    const currentChat = chats.find(chat => chat.id === currentChatId);
    if (currentChat) {
      chatStore.setKey('messages', currentChat.messages);
    }
  }
}

/**
 * Save messages to LocalStorage
 */
export function saveMessagesToLocalStorage(messages: Message[], chatId?: string): void {
  const currentChatId = chatId || chatStore.get().currentChatId;
  if (!currentChatId) return;

  const chat: LocalStorageChat = {
    id: currentChatId,
    messages,
    timestamp: new Date().toISOString(),
  };

  saveChatToLocalStorage(chat);
}

/**
 * Get current chat messages from LocalStorage
 */
export function getCurrentChatMessages(): Message[] {
  const currentChatId = chatStore.get().currentChatId;
  if (!currentChatId) return [];

  const chats = getAllChatsFromLocalStorage();
  const currentChat = chats.find(chat => chat.id === currentChatId);
  return currentChat?.messages || [];
}

// Initialize store on module load
if (typeof window !== 'undefined') {
  initializeChatStore();
}
