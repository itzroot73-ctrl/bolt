import { useLoaderData, useNavigate, useSearchParams } from '@remix-run/react';
import { useState, useEffect, useCallback } from 'react';
import { atom } from 'nanostores';
import { generateId, type JSONValue, type Message } from 'ai';
import { saveChatToLocalStorage, convertToLocalStorageChat, deleteChatFromLocalStorage, setCurrentChatId, getChatFromLocalStorage, getAllChatsFromLocalStorage, type LocalStorageChat } from './localStorage';
import { toast } from 'react-toastify';
import { workbenchStore } from '~/lib/stores/workbench';
import { logStore } from '~/lib/stores/logs'; // Import logStore
import {
  getMessages,
  getNextId,
  getUrlId,
  openDatabase,
  setMessages,
  duplicateChat,
  createChatFromMessages,
  getSnapshot,
  setSnapshot,
  type IChatMetadata,
} from './db';
import type { FileMap } from '~/lib/stores/files';
import type { Snapshot } from './types';
import { webcontainer } from '~/lib/webcontainer';
import { detectProjectCommands, createCommandActionsString } from '~/utils/projectCommands';
import type { ContextAnnotation } from '~/types/context';

export interface ChatHistoryItem {
  id: string;
  urlId?: string;
  description?: string;
  messages: Message[];
  timestamp: string;
  metadata?: IChatMetadata;
}

const persistenceEnabled = !import.meta.env.VITE_DISABLE_PERSISTENCE;

export const db = persistenceEnabled ? await openDatabase() : undefined;

export const chatId = atom<string | undefined>(undefined);
export const description = atom<string | undefined>(undefined);
export const chatMetadata = atom<IChatMetadata | undefined>(undefined);
export function useChatHistory() {
  const navigate = useNavigate();
  const { id: mixedId } = useLoaderData<{ id?: string }>();
  const [searchParams] = useSearchParams();

  const [archivedMessages, setArchivedMessages] = useState<Message[]>([]);
  const [initialMessages, setInitialMessages] = useState<Message[]>([]);
  const [ready, setReady] = useState<boolean>(false);
  const [urlId, setUrlId] = useState<string | undefined>();

  useEffect(() => {
    const loadChat = async () => {
      if (!mixedId) {
        setReady(true);
        return;
      }

      if (db) {
        // Try to load from IndexedDB first
        try {
          const [storedMessages, snapshot] = await Promise.all([
            getMessages(db, mixedId),
            getSnapshot(db, mixedId),
          ]);

          if (storedMessages && storedMessages.messages.length > 0) {
            await processStoredMessages(storedMessages, snapshot);
            return;
          }
        } catch (error) {
          console.error('Error loading from IndexedDB:', error);
          logStore.logError('Failed to load from IndexedDB', error);
        }
      }

      // Fallback to LocalStorage
      try {
        const localStorageChat = getChatFromLocalStorage(mixedId);
        if (localStorageChat && localStorageChat.messages.length > 0) {
          await processLocalStorageChat(localStorageChat);
          return;
        }
      } catch (error) {
        console.error('Error loading from LocalStorage:', error);
      }

      // No chat found in either storage
      navigate('/', { replace: true });
      setReady(true);
    };

    const processStoredMessages = async (storedMessages: ChatHistoryItem, snapshot?: any) => {
      const validSnapshot = snapshot || { chatIndex: '', files: {} };
      const summary = validSnapshot.summary;

      const rewindId = searchParams.get('rewindTo');
      let startingIdx = -1;
      const endingIdx = rewindId
        ? storedMessages.messages.findIndex((m) => m.id === rewindId) + 1
        : storedMessages.messages.length;
      const snapshotIndex = storedMessages.messages.findIndex((m) => m.id === validSnapshot.chatIndex);

      if (snapshotIndex >= 0 && snapshotIndex < endingIdx) {
        startingIdx = snapshotIndex;
      }

      if (snapshotIndex > 0 && storedMessages.messages[snapshotIndex].id == rewindId) {
        startingIdx = -1;
      }

      let filteredMessages = storedMessages.messages.slice(startingIdx + 1, endingIdx);
      let archivedMessages: Message[] = [];

      if (startingIdx >= 0) {
        archivedMessages = storedMessages.messages.slice(0, startingIdx + 1);
      }

      setArchivedMessages(archivedMessages);

      if (startingIdx > 0) {
        const files = Object.entries(validSnapshot?.files || {})
          .map(([key, value]) => {
            if (value?.type !== 'file') {
              return null;
            }

            return {
              content: value.content,
              path: key,
            };
          })
          .filter((x): x is { content: string; path: string } => !!x);
        const projectCommands = await detectProjectCommands(files);
        const commandActionsString = createCommandActionsString(projectCommands);

        filteredMessages = [
          {
            id: generateId(),
            role: 'user',
            content: `Restore project from snapshot`,
            annotations: ['no-store', 'hidden'],
          },
          {
            id: storedMessages.messages[snapshotIndex].id,
            role: 'assistant',
            content: `Bolt Restored your chat from a snapshot. You can revert this message to load the full chat history.
            <boltArtifact id="restored-project-setup" title="Restored Project & Setup" type="bundled">
            ${Object.entries(snapshot?.files || {})
              .map(([key, value]) => {
                if (value?.type === 'file') {
                  return `
                <boltAction type="file" filePath="${key}">
${value.content}
                </boltAction>
                `;
                } else {
                  return ``;
                }
              })
              .join('\n')}
            ${commandActionsString} 
            </boltArtifact>
            `,
            annotations: [
              'no-store',
              ...(summary
                ? [
                    {
                      chatId: storedMessages.messages[snapshotIndex].id,
                      type: 'chatSummary',
                      summary,
                    } satisfies ContextAnnotation,
                  ]
                : []),
            ],
          },
          ...filteredMessages,
        ];
        restoreSnapshot(mixedId);
      }

      setInitialMessages(filteredMessages);
      setUrlId(storedMessages.urlId);
      description.set(storedMessages.description);
      chatId.set(storedMessages.id);
      chatMetadata.set(storedMessages.metadata);
      setReady(true);
    };

    const processLocalStorageChat = async (localStorageChat: LocalStorageChat) => {
      setInitialMessages(localStorageChat.messages);
      setUrlId(localStorageChat.urlId || localStorageChat.id);
      description.set(localStorageChat.description || `Chat ${localStorageChat.id}`);
      chatId.set(localStorageChat.id);
      chatMetadata.set(localStorageChat.metadata);
      setReady(true);
    };

    loadChat();
  }, [mixedId, db, navigate, searchParams]);

  const takeSnapshot = useCallback(
    async (chatIdx: string, files: FileMap, _chatId?: string | undefined, chatSummary?: string) => {
      const id = chatId.get();

      if (!id || !db) {
        return;
      }

      const snapshot: Snapshot = {
        chatIndex: chatIdx,
        files,
        summary: chatSummary,
      };

      // localStorage.setItem(`snapshot:${id}`, JSON.stringify(snapshot)); // Remove localStorage usage
      try {
        await setSnapshot(db, id, snapshot);
      } catch (error) {
        console.error('Failed to save snapshot:', error);
        toast.error('Failed to save chat snapshot.');
      }
    },
    [db],
  );

  const restoreSnapshot = useCallback(async (id: string, snapshot?: Snapshot) => {
    // const snapshotStr = localStorage.getItem(`snapshot:${id}`); // Remove localStorage usage
    const container = await webcontainer;

    const validSnapshot = snapshot || { chatIndex: '', files: {} };

    if (!validSnapshot?.files) {
      return;
    }

    Object.entries(validSnapshot.files).forEach(async ([key, value]) => {
      if (key.startsWith(container.workdir)) {
        key = key.replace(container.workdir, '');
      }

      if (value?.type === 'folder') {
        await container.fs.mkdir(key, { recursive: true });
      }
    });
    Object.entries(validSnapshot.files).forEach(async ([key, value]) => {
      if (value?.type === 'file') {
        if (key.startsWith(container.workdir)) {
          key = key.replace(container.workdir, '');
        }

        await container.fs.writeFile(key, value.content, { encoding: value.isBinary ? undefined : 'utf8' });
      } else {
      }
    });

    // workbenchStore.files.setKey(snapshot?.files)
  }, []);

  return {
    ready: !mixedId || ready,
    initialMessages,
    updateChatMestaData: async (metadata: IChatMetadata) => {
      const id = chatId.get();

      if (!db || !id) {
        return;
      }

      try {
        await setMessages(db, id, initialMessages, urlId, description.get(), undefined, metadata);
        chatMetadata.set(metadata);
      } catch (error) {
        toast.error('Failed to update chat metadata');
        console.error(error);
      }
    },
    storeMessageHistory: async (messages: Message[]) => {
      if (messages.length === 0) {
        return;
      }

      const { firstArtifact } = workbenchStore;
      messages = messages.filter((m) => !m.annotations?.includes('no-store'));

      let _urlId = urlId;

      if (!urlId && firstArtifact?.id && db) {
        const urlId = await getUrlId(db, firstArtifact.id);
        _urlId = urlId;
        navigateChat(urlId);
        setUrlId(urlId);
      }

      let chatSummary: string | undefined = undefined;
      const lastMessage = messages[messages.length - 1];

      if (lastMessage.role === 'assistant') {
        const annotations = lastMessage.annotations as JSONValue[];
        const filteredAnnotations = (annotations?.filter(
          (annotation: JSONValue) =>
            annotation && typeof annotation === 'object' && Object.keys(annotation).includes('type'),
        ) || []) as { type: string; value: any } & { [key: string]: any }[];

        if (filteredAnnotations.find((annotation) => annotation.type === 'chatSummary')) {
          chatSummary = filteredAnnotations.find((annotation) => annotation.type === 'chatSummary')?.summary;
        }
      }

      takeSnapshot(messages[messages.length - 1].id, workbenchStore.files.get(), _urlId, chatSummary);

      if (!description.get() && firstArtifact?.title) {
        description.set(firstArtifact?.title);
      }

      // Ensure chatId.get() is used here as well
      if (initialMessages.length === 0 && !chatId.get()) {
        let nextId: string;
        
        if (db) {
          nextId = await getNextId(db);
        } else {
          // Generate ID for LocalStorage
          nextId = Date.now().toString();
        }

        chatId.set(nextId);
        setCurrentChatId(nextId);

        if (!urlId && db) {
          navigateChat(nextId);
        }
      }

      // Ensure chatId.get() is used for the final setMessages call
      const finalChatId = chatId.get();

      if (!finalChatId) {
        console.error('Cannot save messages, chat ID is not set.');
        toast.error('Failed to save chat messages: Chat ID missing.');
        return;
      }

      // Save to IndexedDB if available
      if (db) {
        try {
          await setMessages(
            db,
            finalChatId,
            [...archivedMessages, ...messages],
            urlId,
            description.get(),
            undefined,
            chatMetadata.get(),
          );
        } catch (error) {
          console.error('Error saving to IndexedDB:', error);
          toast.error('Failed to save to database, using LocalStorage fallback');
        }
      }

      // Always save to LocalStorage as backup
      try {
        const localStorageChat = {
          id: finalChatId,
          urlId: _urlId || finalChatId,
          description: description.get() || `Chat ${finalChatId}`,
          messages: [...archivedMessages, ...messages],
          timestamp: new Date().toISOString(),
          metadata: chatMetadata.get()
        };
        
        saveChatToLocalStorage(localStorageChat);
      } catch (localStorageError) {
        console.error('Error saving to LocalStorage:', localStorageError);
        // Don't show error toast for LocalStorage failures
      }
    },
    duplicateCurrentChat: async (listItemId: string) => {
      if ((!db && !mixedId && !listItemId)) {
        return;
      }

      try {
        let newId: string;
        
        if (db) {
          newId = await duplicateChat(db, mixedId || listItemId);
        } else {
          // LocalStorage duplication
          const chats = getAllChatsFromLocalStorage();
          const chatToDuplicate = chats.find(chat => chat.id === (mixedId || listItemId));
          
          if (!chatToDuplicate) {
            toast.error('Chat not found');
            return;
          }
          
          newId = Date.now().toString();
          const duplicatedChat: LocalStorageChat = {
            ...chatToDuplicate,
            id: newId,
            description: `${chatToDuplicate.description || 'Chat'} (copy)`,
            timestamp: new Date().toISOString()
          };
          
          saveChatToLocalStorage(duplicatedChat);
        }
        
        navigate(`/chat/${newId}`);
        toast.success('Chat duplicated successfully');
      } catch (error) {
        toast.error('Failed to duplicate chat');
        console.log(error);
      }
    },
    importChat: async (description: string, messages: Message[], metadata?: IChatMetadata) => {
      if (!db) {
        return;
      }

      try {
        const newId = await createChatFromMessages(db, description, messages, metadata);
        window.location.href = `/chat/${newId}`;
        toast.success('Chat imported successfully');
      } catch (error) {
        if (error instanceof Error) {
          toast.error('Failed to import chat: ' + error.message);
        } else {
          toast.error('Failed to import chat');
        }
      }
    },
    exportChat: async (id = urlId) => {
      if (!db || !id) {
        return;
      }

      const chat = await getMessages(db, id);
      const chatData = {
        messages: chat.messages,
        description: chat.description,
        exportDate: new Date().toISOString(),
      };

      const blob = new Blob([JSON.stringify(chatData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `chat-${new Date().toISOString()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    },
  };
}

function navigateChat(nextId: string) {
  /**
   * FIXME: Using the intended navigate function causes a rerender for <Chat /> that breaks the app.
   *
   * `navigate(`/chat/${nextId}`, { replace: true });`
   */
  const url = new URL(window.location.href);
  url.pathname = `/chat/${nextId}`;

  window.history.replaceState({}, '', url);
}
