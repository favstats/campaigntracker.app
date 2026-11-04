#!/usr/bin/env Rscript
# Visualizing Campaign Spending vs. Win Chances in US House Races
# Midterms / Congressional Campaign Finance & Digital Advertising

suppressPackageStartupMessages({
  library(tidyverse)
  library(ggrepel)
  library(ggtext)
  library(patchwork)
  library(scales)
  library(showtext)
})

# 1. Setup typography
font_add_google("Inter", "inter")
font_add_google("Newsreader", "newsreader")
showtext_auto()
showtext_opts(dpi = 300)

# 2. Load dataset
data_path <- "/home/favstats/.gemini/antigravity-cli/brain/7ae52411-5966-4a42-8b3b-b58161bac2b8/scratch/house_spending_vs_win_chances.csv"
df <- read_csv(data_path, show_col_types = FALSE)

# Color Palettes
palette_tiers <- c(
  "Toss-up" = "#7c3aed",  # Purple
  "Lean"    = "#f59e0b",  # Amber
  "Likely"  = "#3b82f6",  # Blue
  "Solid"   = "#94a3b8"   # Slate Grey
)

palette_cook <- c(
  "Solid R"  = "#b91c1c",
  "Likely R" = "#ef4444",
  "Lean R"   = "#f97316",
  "Toss-up"  = "#8b5cf6",
  "Lean D"   = "#0ea5e9",
  "Likely D" = "#3b82f6",
  "Solid D"  = "#1d4ed8"
)

# Factor ordering & labels
df <- df |>
  mutate(
    competitiveness_tier = factor(competitiveness_tier, levels = c("Solid", "Likely", "Lean", "Toss-up")),
    cook_rating = factor(cook_rating, levels = c("Solid R", "Likely R", "Lean R", "Toss-up", "Lean D", "Likely D", "Solid D")),
    fec_spent_m = fec_candidate_spent / 1e6,
    # Annotation labels for Panel 1 (FEC)
    annotate_fec = case_when(
      district_label == "MD-06" ~ "MD-06 ($39.1M)\nDelaney (Lean D)",
      district_label == "NH-01" ~ "NH-01 ($38.7M)\nPappas (Likely D)",
      district_label == "NY-17" ~ "NY-17 ($33.7M)\nLawler (Lean R)",
      district_label == "NY-21" ~ "NY-21 ($26.8M)\nStefanik (GOP Lead)",
      district_label == "NY-14" ~ "NY-14 ($25.6M)\nOcasio-Cortez (Safe D)",
      district_label == "CA-45" ~ "CA-45 ($22.1M)\nSteel vs Tran (Toss-up)",
      district_label == "PA-10" ~ "PA-10 ($15.8M)\nPerry vs Stelson",
      district_label == "CO-08" ~ "CO-08 ($15.2M)\nCaraveo vs Evans",
      district_label == "ME-02" ~ "ME-02 ($14.9M)\nGolden vs Theriault",
      district_label == "AK-AL" ~ "AK-AL ($14.5M)\nPeltola vs Begich",
      TRUE ~ NA_character_
    ),
    # Annotation labels for Panel 2 (Digital)
    annotate_dig = case_when(
      district_label == "AK-AL" ~ "AK-AL ($4.32 / res)\nPeltola vs Begich (Toss-up)",
      district_label == "ME-02" ~ "ME-02 ($2.53 / res)\nGolden vs Theriault (Toss-up)",
      district_label == "WI-03" ~ "WI-03 ($2.34 / res)\nVan Orden (Lean R)",
      district_label == "IA-01" ~ "IA-01 ($1.96 / res)\nMiller-Meeks (Toss-up)",
      district_label == "IA-03" ~ "IA-03 ($1.85 / res)\nNunn (Toss-up)",
      district_label == "MI-07" ~ "MI-07 ($1.26 / res)\nBarrett vs Hertel",
      district_label == "OH-13" ~ "OH-13 ($1.20 / res)\nSykes (Lean D)",
      district_label == "CA-45" ~ "CA-45 ($1.15 / res)\nSteel vs Tran",
      district_label == "CO-08" ~ "CO-08 ($1.12 / res)\nCaraveo vs Evans",
      district_label == "NY-14" ~ "NY-14 ($0.45 / res)\nSafe seat · Low ad buy",
      TRUE ~ NA_character_
    )
  )

# Base theme
theme_midterms <- function() {
  theme_minimal(base_family = "inter", base_size = 11) +
    theme(
      plot.background = element_rect(fill = "#fdfdfd", color = NA),
      panel.background = element_rect(fill = "#fdfdfd", color = NA),
      panel.grid.major = element_line(color = "#edf2f7", linewidth = 0.5),
      panel.grid.minor = element_blank(),
      axis.title = element_text(family = "inter", size = 10, face = "bold", color = "#1e293b"),
      axis.text = element_text(family = "inter", size = 8.5, color = "#64748b"),
      plot.title = element_markdown(family = "inter", size = 13.5, face = "bold", color = "#0f172a", lineheight = 1.2),
      plot.subtitle = element_markdown(family = "inter", size = 9.8, color = "#475569", margin = margin(b = 10), lineheight = 1.3),
      plot.caption = element_markdown(family = "inter", size = 8.5, color = "#94a3b8", margin = margin(t = 12)),
      legend.position = "top",
      legend.title = element_text(family = "inter", size = 9, face = "bold", color = "#1e293b"),
      legend.text = element_text(family = "inter", size = 8.5, color = "#475569"),
      plot.margin = margin(t = 8, r = 16, b = 8, l = 10)
    )
}

# -------------------------------------------------------------
# PANEL 1: Total FEC Candidate Disbursements vs Cook PVI
# -------------------------------------------------------------
p1 <- ggplot(df, aes(x = pvi_numeric, y = fec_spent_m)) +
  # Background shaded competitive zone
  annotate("rect", xmin = -5, xmax = 5, ymin = 0, ymax = Inf,
           fill = "#f5f3ff", alpha = 0.55) +
  geom_vline(xintercept = c(-5, 5), linetype = "dashed", color = "#c4b5fd", linewidth = 0.55) +
  # Symmetrical quadratic regression curve
  geom_smooth(method = "lm", formula = y ~ poly(x, 2), se = TRUE,
              color = "#1e293b", fill = "#cbd5e1", linewidth = 1.1, alpha = 0.3) +
  geom_point(aes(color = cook_rating), size = 2.8, alpha = 0.8) +
  scale_color_manual(name = "Cook Rating", values = palette_cook) +
  geom_text_repel(
    aes(label = annotate_fec),
    family = "inter",
    size = 2.65,
    fontface = "bold",
    color = "#0f172a",
    box.padding = 0.55,
    point.padding = 0.4,
    max.overlaps = 30,
    segment.color = "#94a3b8",
    segment.size = 0.35,
    lineheight = 0.88,
    seed = 42
  ) +
  scale_x_continuous(
    limits = c(-32, 38),
    breaks = c(-30, -20, -10, -5, 0, 5, 10, 20, 30),
    labels = c("R+30\n0% D", "R+20\n3%", "R+10\n16%", "R+5\n30%", "EVEN\n50% D", "D+5\n70%", "D+10\n84%", "D+20\n97%", "D+30\n99% D")
  ) +
  scale_y_continuous(labels = label_dollar(prefix = "$", suffix = "M", accuracy = 5), limits = c(0, 42)) +
  labs(
    title = "<b>1 · Total Candidate Campaign Disbursements (FEC)</b>",
    subtitle = "Disbursements form an <b>inverted-U curve</b> peaking at <b>$8.6M</b> in Toss-ups (vs $2.6M–$3.3M in safe seats).<br><i>Exceptions</i>: National lightning rods (AOC, Stefanik) raise millions despite safe seats.",
    x = "Cook Partisan Voting Index (PVI) & Implied Dem Win Probability",
    y = "Total FEC Candidate Disbursements ($ Millions)"
  ) +
  theme_midterms() +
  theme(legend.position = "none")

# -------------------------------------------------------------
# PANEL 2: 30-Day Digital Ad Spend per Resident vs Cook PVI
# -------------------------------------------------------------
p2 <- ggplot(df, aes(x = pvi_numeric, y = spend_per_capita)) +
  # Background shaded competitive zone
  annotate("rect", xmin = -5, xmax = 5, ymin = 0, ymax = Inf,
           fill = "#f5f3ff", alpha = 0.55) +
  geom_vline(xintercept = c(-5, 5), linetype = "dashed", color = "#c4b5fd", linewidth = 0.55) +
  # Symmetrical quadratic regression curve
  geom_smooth(method = "lm", formula = y ~ poly(x, 2), se = TRUE,
              color = "#1e293b", fill = "#cbd5e1", linewidth = 1.1, alpha = 0.3) +
  geom_point(aes(color = cook_rating, size = overall_spend_total), alpha = 0.78) +
  scale_color_manual(name = "Cook Rating", values = palette_cook) +
  scale_size_continuous(name = "30-Day Ad Total", range = c(1.8, 6.5), labels = label_dollar(scale = 1e-3, suffix = "k")) +
  geom_text_repel(
    aes(label = annotate_dig),
    family = "inter",
    size = 2.65,
    fontface = "bold",
    color = "#0f172a",
    box.padding = 0.55,
    point.padding = 0.4,
    max.overlaps = 30,
    segment.color = "#94a3b8",
    segment.size = 0.35,
    lineheight = 0.88,
    seed = 42
  ) +
  scale_x_continuous(
    limits = c(-32, 38),
    breaks = c(-30, -20, -10, -5, 0, 5, 10, 20, 30),
    labels = c("R+30\n0% D", "R+20\n3%", "R+10\n16%", "R+5\n30%", "EVEN\n50% D", "D+5\n70%", "D+10\n84%", "D+20\n97%", "D+30\n99% D")
  ) +
  scale_y_continuous(labels = label_dollar(prefix = "$", accuracy = 0.5), limits = c(0, 4.6)) +
  labs(
    title = "<b>2 · Digital Ad Spending per Resident (Meta + Google + Snapchat)</b>",
    subtitle = "Voters in Toss-up districts face <b>up to $4.32 / resident</b> in targeted digital ads.<br>Safe-district campaigns run minimal local ad buys; money focuses sharply on the tipping points.",
    x = "Cook Partisan Voting Index (PVI) & Implied Dem Win Probability",
    y = "Covered Digital Ad Spend per Resident ($ USD)"
  ) +
  theme_midterms() +
  guides(
    color = guide_legend(title.position = "top", nrow = 1, override.aes = list(size = 3.5, alpha = 1)),
    size = guide_legend(title.position = "top", nrow = 1)
  )

# -------------------------------------------------------------
# PANEL 3: FEC Spending by Competitiveness Tier (Boxplot)
# -------------------------------------------------------------
p3 <- ggplot(df, aes(x = competitiveness_tier, y = fec_spent_m, fill = competitiveness_tier)) +
  geom_jitter(width = 0.22, alpha = 0.35, size = 1.6, color = "#64748b") +
  geom_boxplot(alpha = 0.65, outlier.shape = NA, width = 0.45, color = "#334155", linewidth = 0.55) +
  stat_summary(fun = mean, geom = "point", shape = 23, size = 3.8, fill = "#ffffff", color = "#0f172a", stroke = 1.4) +
  scale_fill_manual(values = palette_tiers) +
  scale_y_continuous(labels = label_dollar(prefix = "$", suffix = "M", accuracy = 5), limits = c(0, 42)) +
  scale_x_discrete(labels = c(
    "Solid\n(n=366)\nMean: $4.2M",
    "Likely\n(n=26)\nMean: $8.0M",
    "Lean\n(n=21)\nMean: $11.4M",
    "Toss-up\n(n=22)\nMean: $11.2M"
  )) +
  labs(
    title = "<b>3 · Candidate Disbursements by Race Rating</b>",
    subtitle = "Competitive seats spend <b>2.7× more</b> overall than safe seats (white diamonds = group mean).",
    x = "Cook Race Competitiveness Tier",
    y = "Total FEC Disbursements ($ Millions)"
  ) +
  theme_midterms() +
  theme(legend.position = "none")

# -------------------------------------------------------------
# PANEL 4: Digital Ad Intensity by Competitiveness Tier (Boxplot)
# -------------------------------------------------------------
p4 <- ggplot(df, aes(x = competitiveness_tier, y = spend_per_capita, fill = competitiveness_tier)) +
  geom_jitter(width = 0.22, alpha = 0.35, size = 1.6, color = "#64748b") +
  geom_boxplot(alpha = 0.65, outlier.shape = NA, width = 0.45, color = "#334155", linewidth = 0.55) +
  stat_summary(fun = mean, geom = "point", shape = 23, size = 3.8, fill = "#ffffff", color = "#0f172a", stroke = 1.4) +
  scale_fill_manual(values = palette_tiers) +
  scale_y_continuous(labels = label_dollar(prefix = "$", accuracy = 0.5), limits = c(0, 4.6)) +
  scale_x_discrete(labels = c(
    "Solid\n(n=366)\nMean: $0.48",
    "Likely\n(n=26)\nMean: $0.60",
    "Lean\n(n=21)\nMean: $0.76",
    "Toss-up\n(n=22)\nMean: $0.97"
  )) +
  labs(
    title = "<b>4 · Digital Ad Pressure by Race Rating</b>",
    subtitle = "Toss-up districts receive <b>2.02× higher</b> ad intensity per capita ($0.97 vs $0.48).",
    x = "Cook Race Competitiveness Tier",
    y = "USD per Resident (30-Day Window)"
  ) +
  theme_midterms() +
  theme(legend.position = "none")

# -------------------------------------------------------------
# COMPOSITE ASSEMBLY
# -------------------------------------------------------------
composite <- (p1 | p2) / (p3 | p4) +
  plot_layout(heights = c(1.3, 1)) +
  plot_annotation(
    title = "Does Campaign Spending Track Win Chances? Evidence from 435 U.S. House Races",
    subtitle = "<b>Yes, but not linearly</b>: Political money follows an <b>inverted-U curve</b> (quadratic p < 0.001), surging into 50/50 Toss-ups and dropping in safe seats.<br>However, spending does not track win chances purely: <i>safe-seat party leaders and celebrity lightning rods raise outsized national war chests</i>.",
    caption = "<b>Data:</b> Midterms Digital Ad Tracker (Meta, Google, Snapchat 30-day window to Nov 3) & Federal Election Commission candidate cycle filings · <b>Ratings:</b> The Cook Political Report with Amy Walter & Cook PVI · <b>Design:</b> Antigravity with ggplot2",
    theme = theme(
      plot.title = element_markdown(family = "newsreader", size = 21, face = "bold", color = "#0f172a", margin = margin(t = 6, b = 6)),
      plot.subtitle = element_markdown(family = "inter", size = 11.5, color = "#334155", margin = margin(b = 14), lineheight = 1.35),
      plot.caption = element_markdown(family = "inter", size = 8.8, color = "#64748b", margin = margin(t = 12, r = 10)),
      plot.background = element_rect(fill = "#fdfdfd", color = NA)
    )
  )

# Save high-res PNG files
out_path1 <- "/home/favstats/.gemini/antigravity-cli/brain/7ae52411-5966-4a42-8b3b-b58161bac2b8/scratch/spending_vs_win_chances.png"
out_path2 <- "/mnt/storage/us-midterms-map/public/assets/spending_vs_win_chances.png"
out_path3 <- "/home/favstats/.gemini/antigravity-cli/brain/7ae52411-5966-4a42-8b3b-b58161bac2b8/spending_vs_win_chances.png"

cairo_save <- function(filename, plot, width = 15, height = 12) {
  ggplot2::ggsave(
    filename = filename,
    plot = plot,
    device = function(...) grDevices::png(..., type = "cairo", res = 300, units = "in"),
    width = width,
    height = height
  )
}

cairo_save(out_path1, composite)
cairo_save(out_path2, composite)
cairo_save(out_path3, composite)

cat("Successfully generated and saved publication plot to:\n", out_path1, "\n", out_path2, "\n", out_path3, "\n")
