import { useEffect, useRef } from "react"
import { Pause, Play, Search, SkipBack, SkipForward, Volume2 } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Slider } from "@/components/ui/slider"
import { cn } from "@/lib/utils"
import { useLineupPlayer } from "@/hooks/use-lineup-player"

function App() {
  const player = useLineupPlayer()
  const paletteInputRef = useRef<HTMLInputElement>(null)
  const progressPercent = player.durationSeconds > 0 ? (player.positionSeconds / player.durationSeconds) * 100 : 0
  const effectiveVolume = Math.round((player.volumeSlider / 100) ** 3 * 100)

  useEffect(() => {
    if (player.paletteOpen) {
      window.requestAnimationFrame(() => paletteInputRef.current?.focus())
    }
  }, [player.paletteOpen])

  return (
    <main className="min-h-dvh overflow-hidden bg-background text-foreground">
      <section className="mx-auto grid min-h-dvh w-full max-w-6xl content-start gap-4 px-4 py-5 sm:px-6 lg:px-8 lg:py-6">
        <div className="pointer-events-none fixed -left-24 top-8 h-52 w-52 rounded-full bg-primary/20 blur-3xl" />
        <div className="pointer-events-none fixed left-1/2 top-44 h-48 w-48 rounded-full bg-rampage-red/20 blur-3xl" />

        <header className="relative z-10 flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <h1 className="text-2xl font-black uppercase leading-none tracking-tight sm:text-3xl">
              Rampage <span className="text-primary">2026</span>
            </h1>
          </div>
          <div className="flex rounded-xl border border-white/10 bg-white/5 p-1 backdrop-blur">
            <Stat label="Artists" value={player.artists.length} />
            <Stat label="Played" value={player.history.length} />
          </div>
        </header>

        <div className="relative z-10 grid items-start gap-6 lg:grid-cols-[1.08fr_0.92fr]">
          <Card className="border-white/10 bg-card/86 shadow-2xl shadow-black/40 backdrop-blur">
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <CardTitle className="text-balance text-2xl font-black uppercase sm:text-3xl">
                    {player.currentReference?.title || player.currentArtist || "song name"}
                  </CardTitle>
                  {player.currentReference ? (
                    <p className="mt-1 font-black uppercase text-primary">{player.currentArtist || "artist"}</p>
                  ) : (
                    <p className="mt-1 text-sm font-bold text-muted-foreground">
                      {player.currentArtist ? "No YouTube media available" : "artist"}
                    </p>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent className="grid gap-5">
              <div className="relative aspect-video overflow-hidden rounded-lg border border-white/10 bg-black">
                <div id="yt-player" className="h-full w-full" />
                {player.currentArtist && !player.currentReference ? (
                  <div className="absolute inset-0 grid place-items-center bg-black/88 p-6 text-center">
                    <div className="grid max-w-sm gap-2">
                      <p className="text-2xl font-black uppercase text-primary">{player.currentArtist}</p>
                      <p className="text-sm font-bold text-muted-foreground">
                        No YouTube media is available for this artist yet.
                      </p>
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="grid gap-4">
                <div className="grid grid-cols-[4.25rem_1fr_4.25rem] items-center gap-2">
                  <Button
                    aria-label="Previous artist"
                    disabled={!player.playerReady || player.currentHistoryIndex <= 0}
                    size="lg"
                    variant="secondary"
                    onClick={player.playPreviousArtist}
                  >
                    <SkipBack className="size-4" />
                  </Button>
                  <Button disabled={!player.playerReady} size="lg" variant="rampage" onClick={player.togglePlay}>
                    {player.isPlaying ? <Pause className="size-4" /> : <Play className="size-4" />}
                    {player.isPlaying ? "Pause" : "Play"}
                  </Button>
                  <Button
                    aria-label="Next artist"
                    disabled={!player.playerReady}
                    size="lg"
                    variant="secondary"
                    onClick={player.playNextArtist}
                  >
                    <SkipForward className="size-4" />
                  </Button>
                </div>

                <Separator />

                <div className="grid gap-4 rounded-lg border border-white/10 bg-white/[0.045] p-3">
                  <div className="grid gap-2">
                    <div className="flex items-center justify-between text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
                      <span>{player.elapsedLabel}</span>
                      <span>{player.durationLabel}</span>
                    </div>
                    <Slider
                      disabled={!player.playerReady}
                      max={player.durationSeconds || 1000}
                      step={1}
                      value={[Math.min(player.positionSeconds, player.durationSeconds || player.positionSeconds)]}
                      onValueChange={([value]) => {
                        player.setIsSeeking(true)
                        player.setPositionSeconds(value)
                      }}
                      onValueCommit={([value]) => player.seekTo(value)}
                    />
                    <Progress className="sr-only" value={progressPercent} />
                  </div>
                  <div className="grid gap-2">
                    <Label className="flex items-center justify-between gap-2 text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
                      <span className="flex items-center gap-2">
                        <Volume2 className="size-4" />
                        Volume
                      </span>
                      <span>{effectiveVolume}%</span>
                    </Label>
                    <Slider
                      disabled={!player.playerReady}
                      max={100}
                      step={1}
                      value={[player.volumeSlider]}
                      onValueChange={([value]) => player.setVolume(value)}
                    />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <aside className="grid content-start gap-4">
            <Card className="border-white/10 bg-card/78 backdrop-blur">
              <CardHeader className="pb-2">
                <div className="flex items-end justify-between gap-3">
                  <div>
                    <CardTitle className="uppercase">Lineup</CardTitle>
                  </div>
                  <Badge variant="outline" className="border-white/10 text-muted-foreground">
                    {player.filteredArtists.length} shown
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="mb-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                  <div className="flex min-h-10 items-center gap-2 rounded-lg border border-white/10 bg-black/24 px-2.5 focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/15">
                    <Search className="size-3.5 shrink-0 text-muted-foreground" />
                    <Input
                      aria-label="Filter lineup artists"
                      className="min-h-9 border-0 bg-transparent px-0 text-sm focus-visible:ring-0"
                      placeholder="Filter artists or genres"
                      type="search"
                      value={player.filter}
                      onChange={(event) => player.setFilter(event.target.value)}
                    />
                    {player.filter ? (
                      <Button className="h-7 px-2 text-[0.68rem] uppercase" variant="ghost" onClick={player.clearFilter}>
                        Clear
                      </Button>
                    ) : null}
                  </div>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button className="h-10 justify-between gap-2 rounded-lg px-3 text-xs uppercase" variant="outline">
                        Genres
                        {player.selectedGenres.length > 0 ? (
                          <Badge variant="rampage" className="h-5 rounded-full px-1.5 text-[0.65rem]">
                            {player.selectedGenres.length}
                          </Badge>
                        ) : null}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-64">
                      {player.genres.map((genre) => (
                        <DropdownMenuCheckboxItem
                          key={genre}
                          checked={player.selectedGenres.includes(genre)}
                          onSelect={(event) => event.preventDefault()}
                          onCheckedChange={() => player.toggleGenre(genre)}
                        >
                          {genre}
                        </DropdownMenuCheckboxItem>
                      ))}
                      {player.selectedGenres.length > 0 ? (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={player.clearGenres}>Clear genres</DropdownMenuItem>
                        </>
                      ) : null}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                <ScrollArea className="h-[38rem] pr-3">
                  <div className="grid gap-1.5">
                    {player.filteredArtists.length > 0 ? (
                      player.filteredArtists.map((artist) => {
                        const failed = player.failedArtists.has(artist.name) || player.catalog.artists?.[artist.name]?.supported === false
                        const matched = player.matchedArtists.has(artist.name)
                        const current = player.currentArtist === artist.name
                        const genres = player.catalog.artists?.[artist.name]?.genres ?? []

                        return (
                          <Button
                            key={artist.name}
                            className={cn(
                              "h-auto min-h-9 justify-between gap-3 rounded-lg px-3 py-2 text-left",
                              matched && "border-accent/35 text-accent",
                              failed && "opacity-40",
                              current && "border-rampage-red/60 bg-rampage-red text-white shadow-[0_0_24px_rgba(255,38,56,0.28)]",
                            )}
                            variant="secondary"
                            onClick={() => player.playArtist(artist.name)}
                            title={genres.join(", ")}
                          >
                            <span className="min-w-0 truncate text-sm font-extrabold uppercase">{artist.name}</span>
                            {genres.length > 0 ? (
                              <span
                                className={cn(
                                  "min-w-0 truncate text-xs font-semibold normal-case text-muted-foreground",
                                  current && "text-white/78",
                                  matched && !current && "text-accent/70",
                                )}
                              >
                                {genres.join(" / ")}
                              </span>
                            ) : null}
                          </Button>
                        )
                      })
                    ) : (
                      <p className="w-full py-8 text-center font-bold text-muted-foreground">No artists match this search.</p>
                    )}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </aside>
        </div>
      </section>

      <Dialog open={player.paletteOpen} onOpenChange={player.setPaletteOpen}>
        <DialogContent className="max-w-2xl border-white/10 bg-popover/96">
          <DialogHeader>
            <DialogTitle>Artist search</DialogTitle>
          </DialogHeader>
          <Input
            ref={paletteInputRef}
            placeholder="Type an artist name"
            value={player.paletteQuery}
            onChange={(event) => player.setPaletteQuery(event.target.value)}
          />
          <ScrollArea className="max-h-[58vh] rounded-lg border border-white/10">
            <div className="grid gap-1 p-2">
              {player.paletteMatches.map((match) => (
                <Button
                  key={match.name}
                  className={cn(
                    "h-auto justify-start rounded-lg px-3 py-2 text-left uppercase",
                    player.currentArtist === match.name && "border-rampage-red/60 bg-rampage-red text-white",
                  )}
                  variant="ghost"
                  onClick={() => {
                    player.setPaletteOpen(false)
                    player.playArtist(match.name)
                  }}
                >
                  <span className="grid gap-1">
                    <span>{match.name}</span>
                  </span>
                </Button>
              ))}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </main>
  )
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="min-w-20 rounded-lg px-3 py-1.5 text-center">
      <div className="text-sm font-black text-white">{value}</div>
      <div className="text-[0.58rem] font-bold uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
    </div>
  )
}

export default App
