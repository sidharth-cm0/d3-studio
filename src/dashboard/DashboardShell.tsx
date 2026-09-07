import React, { useState } from 'react'
import { D3Episode, D3Shot } from '../types/d3'
import { TopBar } from './TopBar'
import { LeftRail, LeftRailSection } from './LeftRail'
import { StoryPanel } from './StoryPanel'
import { ScriptPanel } from './ScriptPanel'
import { SceneNavigator } from './SceneNavigator'
import { ViewportFrame } from './ViewportFrame'
import { ViewportToolbar } from './ViewportToolbar'
import { RightInspector } from './RightInspector'
import { TimelinePanel } from './TimelinePanel'
import { PlaybackControls } from './PlaybackControls'
import { CharacterStrip } from './CharacterStrip'
import './dashboard.css'

export interface DashboardShellProps {
  // App Mount Ref
  mountRef: React.RefObject<any>

  // Core Prompting & Generation
  storyPrompt: string
  setStoryPrompt: (text: string) => void
  multiActorPrompt: string
  setMultiActorPrompt: (text: string) => void
  currentEpisode: D3Episode | null
  currentSceneIndex: number
  selectScene: (idx: number) => void
  goToPreviousScene: () => void
  goToNextScene: () => void
  playStageDialogue: () => void
  playEditedEpisode: () => void
  stopStageDialogue: () => void
  isPlaying: boolean
  status: string
  setStatus: (text: string) => void

  // Export & History
  onUndo: () => void
  isExporting: boolean
  exportSceneGraph: () => void
  exportCameraAnimation: () => void

  // Visual Styles & Cadence
  visualStyle: string
  setVisualStyle: (style: any) => void
  motionCadence: 'auto' | 12 | 24
  setMotionCadence: (cad: 'auto' | 12 | 24) => void

  // Character Customizer Values
  skinColor: string
  setSkinColor: (color: string) => void
  hairColor: string
  setHairColor: (color: string) => void
  shirtColor: string
  setShirtColor: (color: string) => void
  hairStyle: 'short' | 'long'
  setHairStyle: (style: 'short' | 'long') => void
  jawScale: number
  setJawScale: (val: number) => void
  shoulderWidth: number
  setShoulderWidth: (val: number) => void

  // File Inputs / Ref triggers
  onUploadLead: () => void
  onUploadSupporting: () => void

  // Timeline
  selectedTimelineShot: number
  setSelectedTimelineShot: (index: number) => void
  updateShotInEpisode: (index: number, patch: Partial<D3Shot>) => void
  deleteShotInEpisode: (index: number) => void
  duplicateShotInEpisode: (index: number) => void

  // Performance recording & emotes
  isRecordingPerf: boolean
  startPerformanceRecording: () => void
  stopPerformanceRecording: () => void
  togglePerformanceSource: (index: number) => void
  triggerEmote: (emoteName: string, actor?: 1 | 2) => void

  // Environment Stages
  currentStage: string
  setCurrentStage: (stage: string) => void
  onBuildStageEnvironment: (stage: string) => void

  // Cinematic shots selection
  selectedShot: string
  applyCameraShot: (shotKey: string) => void

  // Camera preview video (bound when mocap is active)
  videoRef: React.RefObject<HTMLVideoElement | null>
}

export function DashboardShell({
  mountRef,
  storyPrompt,
  setStoryPrompt,
  multiActorPrompt,
  setMultiActorPrompt,
  currentEpisode,
  currentSceneIndex,
  selectScene,
  goToPreviousScene,
  goToNextScene,
  playStageDialogue,
  playEditedEpisode,
  stopStageDialogue,
  isPlaying,
  status,
  setStatus,
  onUndo,
  isExporting,
  exportSceneGraph,
  exportCameraAnimation,
  visualStyle,
  setVisualStyle,
  motionCadence,
  setMotionCadence,
  skinColor,
  setSkinColor,
  hairColor,
  setHairColor,
  shirtColor,
  setShirtColor,
  hairStyle,
  setHairStyle,
  jawScale,
  setJawScale,
  shoulderWidth,
  setShoulderWidth,
  onUploadLead,
  onUploadSupporting,
  selectedTimelineShot,
  setSelectedTimelineShot,
  updateShotInEpisode,
  deleteShotInEpisode,
  duplicateShotInEpisode,
  isRecordingPerf,
  startPerformanceRecording,
  stopPerformanceRecording,
  togglePerformanceSource,
  triggerEmote,
  currentStage,
  setCurrentStage,
  onBuildStageEnvironment,
  selectedShot,
  applyCameraShot,
  videoRef,
}: DashboardShellProps) {
  // Navigation & Shell states
  const [activeSection, setActiveSection] = useState<LeftRailSection>('story')
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(false)
  const [inspectorCollapsed, setInspectorCollapsed] = useState<boolean>(false)
  const [timelineCollapsed, setTimelineCollapsed] = useState<boolean>(false)
  const [aiDirectorMode, setAiDirectorMode] = useState<'ai' | 'director'>('ai')

  // Contextual Selection (Right Inspector)
  const [activeTarget, setActiveTarget] = useState<'scene' | 'lead' | 'supporting' | 'object'>('scene')

  // Display Names for Actors (with fallbacks)
  const leadDisplayName = currentEpisode?.castSlots?.find((c) => c.slot === 1)?.displayName ?? 'Lead Actor'
  const supportingDisplayName = currentEpisode?.castSlots?.find((c) => c.slot === 2)?.displayName ?? 'Supporting Actor'

  // STORY PRESETS catalog (reused from App.tsx)
  const STORY_PRESETS = [
    { label: 'Noir Mystery', prompt: "A detective enters an abandoned warehouse at midnight. He slowly walks forward, looks around suspiciously, hears a noise behind him, turns around and says, 'Who's there?'" },
    { label: 'Cyber Infiltration', prompt: 'A netrunner jacks into a secure corporate core, discovers illegal telemetry data, and warns their operative to disconnect immediately.' },
    { label: 'Live Breaking News', prompt: 'A news anchor presents breaking satellite data while the remote correspondent delivers live verification from the field.' },
  ]

  // Customizer selection trigger (clicking character strip changes focus in Inspector)
  const handleSelectCharacter = (target: 'lead' | 'supporting') => {
    setActiveTarget(target)
    setInspectorCollapsed(false)
  }

  // Next / Previous Shot Helpers for Playback Bar
  const handlePreviousShot = () => {
    if (selectedTimelineShot > 0) {
      setSelectedTimelineShot(selectedTimelineShot - 1)
    }
  }

  const handleNextShot = () => {
    const activeScene = currentEpisode?.scenes[currentSceneIndex]
    if (activeScene && selectedTimelineShot < activeScene.shots.length - 1) {
      setSelectedTimelineShot(selectedTimelineShot + 1)
    }
  }

  const selectStage = (key: string) => {
    setCurrentStage(key)
    onBuildStageEnvironment(key)
  }

  const activeSceneTitle = currentEpisode?.scenes[currentSceneIndex]?.title ?? 'Studio Interior'
  const activeSceneNumber = currentEpisode?.scenes[currentSceneIndex]?.sceneNumber ?? (currentSceneIndex + 1)
  const activeSceneShots = currentEpisode?.scenes[currentSceneIndex]?.shots ?? []
  const totalDuration = activeSceneShots.reduce((s, sh) => s + sh.duration, 0)

  const stageOptionsList = [
    { key: 'cyberpunk', name: 'Cyberpunk' },
    { key: 'broadcast', name: 'Newsroom' },
    { key: 'minimal', name: 'Minimal' },
  ]

  return (
    <div className={`d3-dashboard-shell d3-dashboard-shell--${aiDirectorMode === 'ai' ? 'ai-mode' : 'director-mode'}`}>
      {/* 1. TOP BAR */}
      <TopBar
        projectName={currentEpisode?.title ?? 'Cinematic Suite'}
        currentSequence={activeSceneTitle}
        aiDirectorMode={aiDirectorMode}
        setAiDirectorMode={setAiDirectorMode}
        onUndo={onUndo}
        onExport={exportSceneGraph}
        isExporting={isExporting}
        visualStyle={visualStyle}
        setVisualStyle={setVisualStyle}
        motionCadence={motionCadence}
        setMotionCadence={setMotionCadence}
      />

      {/* 2. LEFT RAIL */}
      <LeftRail
        activeSection={activeSection}
        setActiveSection={setActiveSection}
        sidebarCollapsed={sidebarCollapsed}
        setSidebarCollapsed={setSidebarCollapsed}
      />

      {/* 3. EXPANDED LEFT CONTEXT PANEL */}
      <div className={`d3-sidebar-expanded ${sidebarCollapsed ? 'd3-sidebar-expanded--collapsed' : ''}`}>
        {activeSection === 'story' && (
          <StoryPanel
            storyPrompt={storyPrompt}
            setStoryPrompt={setStoryPrompt}
            onGenerate={playStageDialogue}
            onPlay={playEditedEpisode}
            onStop={stopStageDialogue}
            isPlaying={isPlaying}
            currentEpisode={currentEpisode}
            storyPresets={STORY_PRESETS}
            setStatus={setStatus}
          />
        )}

        {activeSection === 'script' && (
          <ScriptPanel
            multiActorPrompt={multiActorPrompt}
            setMultiActorPrompt={setMultiActorPrompt}
            onPlay={playStageDialogue}
            onStop={stopStageDialogue}
            isPlaying={isPlaying}
            setStatus={setStatus}
          />
        )}

        {activeSection === 'scenes' && (
          <SceneNavigator
            currentEpisode={currentEpisode}
            currentSceneIndex={currentSceneIndex}
            onSelectScene={selectScene}
            onPrevious={goToPreviousScene}
            onNext={goToNextScene}
            setStatus={setStatus}
          />
        )}

        {activeSection === 'characters' && (
          <div className="d3-flex-col d3-gap-4">
            <CharacterStrip
              leadName={leadDisplayName}
              supportingName={supportingDisplayName}
              onSelectCharacter={handleSelectCharacter}
              activeTarget={activeTarget === 'lead' || activeTarget === 'supporting' ? (activeTarget as any) : null}
            />
            <div className="d3-inspector-section" style={{ borderTop: '1px solid var(--d3-border)', paddingTop: '16px' }}>
              <div className="d3-panel-section-title">Character Customizer Quick Toggle</div>
              <button
                type="button"
                className="d3-topbar__btn d3-topbar__btn--primary"
                onClick={() => {
                  setActiveTarget('lead')
                  setSidebarCollapsed(false)
                }}
                style={{ width: '100%', height: '32px', fontSize: '11px', justifyContent: 'center' }}
              >
                Customize Lead
              </button>
            </div>
          </div>
        )}

        {activeSection === 'environment' && (
          <div className="d3-flex-col d3-gap-4">
            <div className="d3-panel-section-title">Stage Presets</div>
            {stageOptionsList.map((opt) => {
              const isSelected = currentStage === opt.key
              return (
                <button
                  key={opt.key}
                  type="button"
                  className={`d3-character-strip-item ${isSelected ? 'd3-character-strip-item--selected' : ''}`}
                  onClick={() => selectStage(opt.key)}
                  style={{
                    borderColor: isSelected ? 'var(--theme-accent)' : 'var(--d3-border)',
                    background: isSelected ? 'var(--theme-accent-bg)' : 'var(--d3-surface-1)',
                    justifyContent: 'center',
                    fontWeight: 700,
                  }}
                >
                  {opt.name}
                </button>
              )
            })}
          </div>
        )}

        {activeSection === 'mocap' && (
          <div className="d3-flex-col d3-gap-3">
            <div className="d3-panel-section-title">Live Performance Rig</div>
            <button
              type="button"
              className="d3-topbar__btn d3-topbar__btn--primary"
              onClick={isRecordingPerf ? stopPerformanceRecording : startPerformanceRecording}
              style={{
                width: '100%',
                height: '40px',
                fontSize: '12px',
                background: isRecordingPerf ? 'var(--d3-danger)' : 'var(--theme-accent)',
                color: isRecordingPerf ? '#fff' : 'var(--d3-black)',
                fontWeight: 800,
              }}
            >
              {isRecordingPerf ? '⏹ Stop Performance Recording' : '🔴 Record Mocap Performance'}
            </button>

            <button
              type="button"
              className="d3-topbar__btn"
              onClick={() => togglePerformanceSource(selectedTimelineShot)}
              style={{ width: '100%', height: '32px', fontSize: '11px', justifyContent: 'center' }}
            >
              AI ⇄ USER Performance Toggle
            </button>

            {/* Emotes triggers */}
            <div className="d3-inspector-section" style={{ borderTop: '1px solid var(--d3-border)', paddingTop: '12px', marginTop: '8px' }}>
              <div className="d3-panel-section-title">Staging Emotes</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                <button type="button" className="d3-topbar__btn" onClick={() => triggerEmote('wave', 1)} style={{ fontSize: '10px', height: '24px', justifyContent: 'center' }}>Wave (Lead)</button>
                <button type="button" className="d3-topbar__btn" onClick={() => triggerEmote('look_around', 1)} style={{ fontSize: '10px', height: '24px', justifyContent: 'center' }}>Look Around</button>
                <button type="button" className="d3-topbar__btn" onClick={() => triggerEmote('turn_head', 2)} style={{ fontSize: '10px', height: '24px', justifyContent: 'center' }}>Turn (Supporting)</button>
                <button type="button" className="d3-topbar__btn" onClick={() => triggerEmote('bow', 2)} style={{ fontSize: '10px', height: '24px', justifyContent: 'center' }}>Bow</button>
              </div>
            </div>

            {/* Mocap video preview display */}
            {activeSection === 'mocap' && videoRef && (
              <div className="d3-mocap-monitor" style={{ position: 'relative', bottom: '0', right: '0', marginTop: '16px' }}>
                <div style={{ textTransform: 'uppercase', fontSize: '8px', fontWeight: 'bold', color: 'var(--d3-text-muted)', marginBottom: '4px' }}>MOCAP VIEWPORT MONITOR</div>
                <video ref={videoRef as any} autoPlay playsInline muted />
              </div>
            )}
          </div>
        )}
      </div>

      {/* 4. CENTRAL VIEWPORT AREA */}
      <ViewportFrame
        mountRef={mountRef}
        currentSceneTitle={activeSceneTitle}
        currentSceneNumber={activeSceneNumber}
        selectedShot={selectedShot}
        onApplyCameraShot={applyCameraShot}
        motionCadence={motionCadence}
        visualStyle={visualStyle}
        isPlaying={isPlaying}
        onPlay={playEditedEpisode}
        onStop={stopStageDialogue}
      >
        {/* Floating Viewport Toolbar */}
        <ViewportToolbar />

        {/* Cinematic Non-blocking Status Bar overlayed in Viewport bottom */}
        <div className="d3-status-bar" style={{ position: 'absolute', bottom: '12px', left: '56px', background: 'rgba(10, 15, 19, 0.8)', padding: '4px 10px', border: '1px solid var(--d3-border)', borderRadius: '4px', fontSize: '9px', fontWeight: 600, color: 'var(--d3-text-secondary)', zIndex: 20 }}>
          <span style={{ display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%', background: isPlaying ? 'var(--d3-success)' : 'var(--d3-muted)', marginRight: '6px' }} />
          {status}
        </div>
      </ViewportFrame>

      {/* 5. RIGHT CONTEXTUAL INSPECTOR */}
      <RightInspector
        currentStage={currentStage}
        setCurrentStage={setCurrentStage}
        onBuildStageEnvironment={onBuildStageEnvironment}
        selectedShot={selectedShot}
        onApplyCameraShot={applyCameraShot}
        onExportCameraAnimation={exportCameraAnimation}
        activeTarget={activeTarget}
        setActiveTarget={setActiveTarget}
        skinColor={skinColor}
        setSkinColor={setSkinColor}
        hairColor={hairColor}
        setHairColor={setHairColor}
        shirtColor={shirtColor}
        setShirtColor={setShirtColor}
        hairStyle={hairStyle}
        setHairStyle={setHairStyle}
        jawScale={jawScale}
        setJawScale={setJawScale}
        shoulderWidth={shoulderWidth}
        setShoulderWidth={setShoulderWidth}
        leadName={leadDisplayName}
        supportingName={supportingDisplayName}
        onUploadLead={onUploadLead}
        onUploadSupporting={onUploadSupporting}
        isInspectorCollapsed={inspectorCollapsed}
        setInspectorCollapsed={setInspectorCollapsed}
      />

      {/* 6. BOTTOM TIMELINE PANEL */}
      <div style={{ gridArea: 'timeline', display: 'flex', flexDirection: 'column' }}>
        {currentEpisode && (
          <TimelinePanel
            episode={currentEpisode}
            activeSceneIndex={currentSceneIndex}
            selectedShotIndex={selectedTimelineShot}
            onSelectShot={setSelectedTimelineShot}
            onUpdateShot={updateShotInEpisode}
            onDeleteShot={deleteShotInEpisode}
            onDuplicateShot={duplicateShotInEpisode}
            onPlayFromShot={() => playEditedEpisode()}
            disabled={isPlaying}
            timelineCollapsed={timelineCollapsed}
            setTimelineCollapsed={setTimelineCollapsed}
          />
        )}

        {/* 7. PLAYBACK CONTROLS */}
        <PlaybackControls
          isPlaying={isPlaying}
          onPlay={playEditedEpisode}
          onStop={stopStageDialogue}
          onPreviousShot={handlePreviousShot}
          onNextShot={handleNextShot}
          currentShotNumber={selectedTimelineShot + 1}
          totalShots={activeSceneShots.length}
          totalDuration={totalDuration}
          motionCadence={motionCadence}
          setMotionCadence={setMotionCadence}
        />
      </div>
    </div>
  )
}

export default DashboardShell
