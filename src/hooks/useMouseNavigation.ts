// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef, useCallback } from 'react';
import { ViewTab, DirectoryRecord, PageRecord, FileRecord } from '../types';

export interface UseMouseNavigationProps {
  activeTab: ViewTab;
  setActiveTab: (tab: ViewTab) => void;
  selectedDirectory: DirectoryRecord | null;
  setSelectedDirectory: (dir: DirectoryRecord | null) => void;
  directories: DirectoryRecord[];
  showExportModal: boolean;
  setShowExportModal: (show: boolean) => void;
  pendingExternalUrl: string | null;
  setPendingExternalUrl: (url: string | null) => void;
  showOwnershipWarning: boolean;
  setShowOwnershipWarning: (show: boolean) => void;
  paramTab?: 'standard' | 'advanced';
  setParamTab?: (tab: 'standard' | 'advanced') => void;
  showAdvanced?: boolean;
  setShowAdvanced?: (show: boolean) => void;
  inspectedPage?: PageRecord | null;
  setInspectedPage?: (page: PageRecord | null) => void;
  pages?: PageRecord[];
  selectedFile?: FileRecord | null;
  setSelectedFile?: (file: FileRecord | null) => void;
  files?: FileRecord[];
}

export interface NavigationSnapshot {
  tab: ViewTab;
  paramTab?: 'standard' | 'advanced';
  showAdvanced?: boolean;
  selectedDirectoryPath: string | null;
  selectedFilePath: string | null;
  inspectedPageId: string | null;
  showExportModal: boolean;
  pendingExternalUrl: string | null;
  showOwnershipWarning: boolean;
}

function areSnapshotsEqual(a: NavigationSnapshot, b: NavigationSnapshot): boolean {
  return (
    a.tab === b.tab &&
    a.paramTab === b.paramTab &&
    Boolean(a.showAdvanced) === Boolean(b.showAdvanced) &&
    a.selectedDirectoryPath === b.selectedDirectoryPath &&
    a.selectedFilePath === b.selectedFilePath &&
    a.inspectedPageId === b.inspectedPageId &&
    a.showExportModal === b.showExportModal &&
    a.pendingExternalUrl === b.pendingExternalUrl &&
    a.showOwnershipWarning === b.showOwnershipWarning
  );
}

export function useMouseNavigation({
  activeTab,
  setActiveTab,
  selectedDirectory,
  setSelectedDirectory,
  directories,
  showExportModal,
  setShowExportModal,
  pendingExternalUrl,
  setPendingExternalUrl,
  showOwnershipWarning,
  setShowOwnershipWarning,
  paramTab,
  setParamTab,
  showAdvanced,
  setShowAdvanced,
  inspectedPage,
  setInspectedPage,
  pages,
  selectedFile,
  setSelectedFile,
  files,
}: UseMouseNavigationProps) {
  // Initial snapshot on mounting
  const initialSnapshot: NavigationSnapshot = {
    tab: activeTab,
    paramTab,
    showAdvanced,
    selectedDirectoryPath: selectedDirectory?.path ?? null,
    selectedFilePath: selectedFile?.path ?? null,
    inspectedPageId: inspectedPage?.id ?? null,
    showExportModal,
    pendingExternalUrl,
    showOwnershipWarning,
  };

  // Full chronological history stack and current position pointer
  const historyStackRef = useRef<NavigationSnapshot[]>([initialSnapshot]);
  const currentIndexRef = useRef<number>(0);

  // Guard flag preventing recorded transitions while programmatically applying a state
  const isNavigatingRef = useRef<boolean>(false);

  // Stack of custom registered modal dismiss functions (LIFO)
  const customModalDismissStackRef = useRef<Array<() => boolean>>([]);

  // Keep latest state references accessible in callbacks
  const stateRef = useRef({
    activeTab,
    selectedDirectory,
    showExportModal,
    pendingExternalUrl,
    showOwnershipWarning,
    paramTab,
    showAdvanced,
    directories,
    inspectedPage,
    pages,
    selectedFile,
    files,
  });

  stateRef.current = {
    activeTab,
    selectedDirectory,
    showExportModal,
    pendingExternalUrl,
    showOwnershipWarning,
    paramTab,
    showAdvanced,
    directories,
    inspectedPage,
    pages,
    selectedFile,
    files,
  };

  // Check if prior page exists in history
  const canGoBack = useCallback((): boolean => {
    if (customModalDismissStackRef.current.length > 0) return true;
    return currentIndexRef.current > 0;
  }, []);

  // Check if forward page exists in history
  const canGoForward = useCallback((): boolean => {
    return currentIndexRef.current < historyStackRef.current.length - 1;
  }, []);

  // Apply a snapshot to the application state
  const applySnapshot = useCallback(
    (target: NavigationSnapshot) => {
      isNavigatingRef.current = true;
      const current = stateRef.current;

      // 1. Tab
      if (target.tab !== current.activeTab) {
        setActiveTab(target.tab);
      }

      // 2. Param tab & advanced settings
      if (
        setParamTab &&
        target.paramTab &&
        target.paramTab !== current.paramTab
      ) {
        setParamTab(target.paramTab);
      }
      if (
        setShowAdvanced &&
        typeof target.showAdvanced === 'boolean' &&
        target.showAdvanced !== current.showAdvanced
      ) {
        setShowAdvanced(target.showAdvanced);
      }

      // 3. Directory modal (supports drilldown navigation)
      const currentDirPath = current.selectedDirectory?.path ?? null;
      if (currentDirPath !== target.selectedDirectoryPath) {
        if (target.selectedDirectoryPath) {
          const found = current.directories.find(
            (d) => d.path === target.selectedDirectoryPath
          );
          setSelectedDirectory(found || null);
        } else {
          setSelectedDirectory(null);
        }
      }

      // 4. File modal
      if (setSelectedFile) {
        const currentFilePath = current.selectedFile?.path ?? null;
        if (currentFilePath !== target.selectedFilePath) {
          if (target.selectedFilePath && current.files) {
            const found = current.files.find(
              (f) => f.path === target.selectedFilePath
            );
            setSelectedFile(found || null);
          } else {
            setSelectedFile(null);
          }
        }
      }

      // 5. Inspected Page modal
      if (setInspectedPage) {
        const currentInspectId = current.inspectedPage?.id ?? null;
        if (currentInspectId !== target.inspectedPageId) {
          if (target.inspectedPageId && current.pages) {
            const found = current.pages.find(
              (p) => p.id === target.inspectedPageId
            );
            setInspectedPage(found || null);
          } else {
            setInspectedPage(null);
          }
        }
      }

      // 6. System modals
      if (target.showExportModal !== current.showExportModal) {
        setShowExportModal(target.showExportModal);
      }
      if (target.pendingExternalUrl !== current.pendingExternalUrl) {
        setPendingExternalUrl(target.pendingExternalUrl);
      }
      if (target.showOwnershipWarning !== current.showOwnershipWarning) {
        setShowOwnershipWarning(target.showOwnershipWarning);
      }

      // Release navigation lock once React render cycle settles
      setTimeout(() => {
        isNavigatingRef.current = false;
      }, 75);
    },
    [
      setActiveTab,
      setParamTab,
      setShowAdvanced,
      setSelectedDirectory,
      setSelectedFile,
      setInspectedPage,
      setShowExportModal,
      setPendingExternalUrl,
      setShowOwnershipWarning,
    ]
  );

  // Initialize browser history entry on initial mount
  useEffect(() => {
    try {
      window.history.replaceState({ appletNavIndex: 0 }, '');
    } catch {
      // Sandbox fallback
    }
  }, []);

  // Track user-initiated state changes and maintain forward/back history
  useEffect(() => {
    if (isNavigatingRef.current) {
      return;
    }

    const currentSnapshot: NavigationSnapshot = {
      tab: activeTab,
      paramTab,
      showAdvanced,
      selectedDirectoryPath: selectedDirectory?.path ?? null,
      selectedFilePath: selectedFile?.path ?? null,
      inspectedPageId: inspectedPage?.id ?? null,
      showExportModal,
      pendingExternalUrl,
      showOwnershipWarning,
    };

    const history = historyStackRef.current;
    const pointer = currentIndexRef.current;
    const currentRecorded = history[pointer];

    if (currentRecorded && areSnapshotsEqual(currentRecorded, currentSnapshot)) {
      return;
    }

    // If user closed a modal or navigated back via UI controls (e.g. clicking 'X' or cancel):
    // If current snapshot matches the state immediately prior in history, simply decrement the pointer
    // so that forward history remains preserved for forward navigation!
    if (
      pointer > 0 &&
      areSnapshotsEqual(history[pointer - 1], currentSnapshot)
    ) {
      currentIndexRef.current = pointer - 1;
      return;
    }

    // If user clicked forward in UI controls to a state already in forward history:
    if (
      pointer < history.length - 1 &&
      areSnapshotsEqual(history[pointer + 1], currentSnapshot)
    ) {
      currentIndexRef.current = pointer + 1;
      return;
    }

    // Brand new user action:
    // Truncate any forward history and append the new state to the stack
    const updatedHistory = history.slice(0, pointer + 1);
    updatedHistory.push(currentSnapshot);
    historyStackRef.current = updatedHistory;
    currentIndexRef.current = updatedHistory.length - 1;

    try {
      window.history.pushState({ appletNavIndex: currentIndexRef.current }, '');
    } catch {
      // Sandbox fallback
    }
  }, [
    activeTab,
    paramTab,
    showAdvanced,
    selectedDirectory?.path,
    selectedFile?.path,
    inspectedPage?.id,
    showExportModal,
    pendingExternalUrl,
    showOwnershipWarning,
  ]);

  // Handle navigate backward (Mouse 4 or Alt+ArrowLeft or Backspace)
  const handleNavigateBack = useCallback(
    (syncBrowserHistory = true): boolean => {
      // 1. Custom registered modal dismissal has top priority
      if (customModalDismissStackRef.current.length > 0) {
        const dismiss = customModalDismissStackRef.current.pop();
        if (dismiss && dismiss()) {
          return true;
        }
      }

      // 2. Linear chronological page history
      if (currentIndexRef.current > 0) {
        const targetIndex = currentIndexRef.current - 1;
        currentIndexRef.current = targetIndex;
        applySnapshot(historyStackRef.current[targetIndex]);

        if (syncBrowserHistory) {
          try {
            window.history.back();
          } catch {
            // Sandbox fallback
          }
        }
        return true;
      }

      return false;
    },
    [applySnapshot]
  );

  // Handle navigate forward (Mouse 5 or Alt+ArrowRight)
  const handleNavigateForward = useCallback(
    (syncBrowserHistory = true): boolean => {
      // Linear chronological page history forward
      if (currentIndexRef.current < historyStackRef.current.length - 1) {
        const targetIndex = currentIndexRef.current + 1;
        currentIndexRef.current = targetIndex;
        applySnapshot(historyStackRef.current[targetIndex]);

        if (syncBrowserHistory) {
          try {
            window.history.forward();
          } catch {
            // Sandbox fallback
          }
        }
        return true;
      }

      return false;
    },
    [applySnapshot]
  );

  // Listen to popstate event (from browser back/forward buttons or host environment)
  useEffect(() => {
    const onPopState = (e: PopStateEvent) => {
      if (isNavigatingRef.current) return;

      const targetIndex = e.state?.appletNavIndex;
      if (typeof targetIndex === 'number') {
        if (
          targetIndex >= 0 &&
          targetIndex < historyStackRef.current.length &&
          targetIndex !== currentIndexRef.current
        ) {
          currentIndexRef.current = targetIndex;
          applySnapshot(historyStackRef.current[targetIndex]);
        }
      }
    };

    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [applySnapshot]);

  // Global Mouse & Keyboard Event Listeners
  useEffect(() => {
    let lastNavTime = 0;
    const DEBOUNCE_DELAY_MS = 120;

    const onMouseDown = (e: MouseEvent) => {
      if (e.button === 3) {
        if (canGoBack()) {
          e.preventDefault();
          e.stopPropagation();
        }
      } else if (e.button === 4) {
        if (canGoForward()) {
          e.preventDefault();
          e.stopPropagation();
        }
      }
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.button === 3) {
        if (canGoBack()) {
          e.preventDefault();
          e.stopPropagation();
        }
      } else if (e.button === 4) {
        if (canGoForward()) {
          e.preventDefault();
          e.stopPropagation();
        }
      }
    };

    const onMouseUp = (e: MouseEvent) => {
      if (e.button === 3) {
        if (canGoBack()) {
          e.preventDefault();
          e.stopPropagation();

          const now = Date.now();
          if (now - lastNavTime >= DEBOUNCE_DELAY_MS) {
            lastNavTime = now;
            handleNavigateBack(true);
          }
        }
      } else if (e.button === 4) {
        if (canGoForward()) {
          e.preventDefault();
          e.stopPropagation();

          const now = Date.now();
          if (now - lastNavTime >= DEBOUNCE_DELAY_MS) {
            lastNavTime = now;
            handleNavigateForward(true);
          }
        }
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      if (e.button === 3) {
        if (canGoBack()) {
          e.preventDefault();
          e.stopPropagation();
        }
      } else if (e.button === 4) {
        if (canGoForward()) {
          e.preventDefault();
          e.stopPropagation();
        }
      }
    };

    const onAuxClick = (e: MouseEvent) => {
      if (e.button === 3) {
        if (canGoBack()) {
          e.preventDefault();
          e.stopPropagation();
        }
      } else if (e.button === 4) {
        if (canGoForward()) {
          e.preventDefault();
          e.stopPropagation();
        }
      }
    };

    // Keyboard shortcuts (Alt + ArrowLeft for Back, Alt + ArrowRight for Forward, Backspace)
    const onKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      const isInput =
        activeEl instanceof HTMLInputElement ||
        activeEl instanceof HTMLTextAreaElement ||
        (activeEl && (activeEl as HTMLElement).isContentEditable);

      if (e.altKey && e.key === 'ArrowLeft') {
        if (canGoBack()) {
          e.preventDefault();
          e.stopPropagation();
          handleNavigateBack(true);
        }
        // If canGoBack() is false, default browser back runs
      } else if (e.altKey && e.key === 'ArrowRight') {
        if (canGoForward()) {
          e.preventDefault();
          e.stopPropagation();
          handleNavigateForward(true);
        }
        // If canGoForward() is false, default browser forward runs
      } else if (e.key === 'Backspace' && !isInput && !e.altKey && !e.ctrlKey && !e.metaKey) {
        if (canGoBack()) {
          e.preventDefault();
          e.stopPropagation();
          handleNavigateBack(true);
        }
      }
    };

    window.addEventListener('mousedown', onMouseDown, { capture: true, passive: false });
    window.addEventListener('pointerdown', onPointerDown, { capture: true, passive: false });
    window.addEventListener('mouseup', onMouseUp, { capture: true, passive: false });
    window.addEventListener('pointerup', onPointerUp, { capture: true, passive: false });
    window.addEventListener('auxclick', onAuxClick, { capture: true, passive: false });
    window.addEventListener('keydown', onKeyDown, { capture: true });

    return () => {
      window.removeEventListener('mousedown', onMouseDown, { capture: true });
      window.removeEventListener('pointerdown', onPointerDown, { capture: true });
      window.removeEventListener('mouseup', onMouseUp, { capture: true });
      window.removeEventListener('pointerup', onPointerUp, { capture: true });
      window.removeEventListener('auxclick', onAuxClick, { capture: true });
      window.removeEventListener('keydown', onKeyDown, { capture: true });
    };
  }, [canGoBack, canGoForward, handleNavigateBack, handleNavigateForward]);

  const registerCustomModal = useCallback((dismissFn: () => boolean) => {
    customModalDismissStackRef.current.push(dismissFn);
    return () => {
      customModalDismissStackRef.current = customModalDismissStackRef.current.filter(
        (fn) => fn !== dismissFn
      );
    };
  }, []);

  return {
    navigateBack: handleNavigateBack,
    navigateForward: handleNavigateForward,
    registerCustomModal,
    canGoBack,
    canGoForward,
    historyLength: historyStackRef.current.length,
    historyIndex: currentIndexRef.current,
  };
}
