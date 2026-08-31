export type PluginItem = {
  id: string
  name: string
  description: string
  href: string
  image: string
}

export type PluginSection = {
  title: string
  slug: string
  cards: PluginItem[]
  moreLabel: string
  moreHref: string
  moreIcons: Array<{ name: string; image: string }>
}

export const PLUGIN_SECTIONS: PluginSection[] = [
  {
    "title": "Popular",
    "slug": "featured",
    "cards": [
      {
        "id": "plugin_connector_1p_95d39881713c8191931482a62d6edff9",
        "name": "Gmail",
        "description": "Read and manage Gmail",
        "href": "/plugins/plugin_connector_1p_95d39881713c8191931482a62d6edff9",
        "image": "/plugins-app/plugin_connector_1p_95d39881713c8191931482a62d6edff9.png"
      },
      {
        "id": "plugin_connector_1p_1a69035c238881919c4190932b2df699",
        "name": "GitHub",
        "description": "Triage PRs, issues, CI, and publish flows",
        "href": "/plugins/plugin_connector_1p_1a69035c238881919c4190932b2df699",
        "image": "/plugins-app/plugin_connector_1p_1a69035c238881919c4190932b2df699.png"
      },
      {
        "id": "plugin_connector_1p_ab21a553bfbc81919ea8fd1858e3ffa7",
        "name": "Google Drive",
        "description": "Drive, Docs, Sheets or Slides",
        "href": "/plugins/plugin_connector_1p_ab21a553bfbc81919ea8fd1858e3ffa7",
        "image": "/plugins-app/plugin_connector_1p_ab21a553bfbc81919ea8fd1858e3ffa7.png"
      },
      {
        "id": "plugin_connector_1p_f8509de903288191b14a160c6c5d20b0",
        "name": "Google Calendar",
        "description": "Manage Google Calendar events",
        "href": "/plugins/plugin_connector_1p_f8509de903288191b14a160c6c5d20b0",
        "image": "/plugins-app/plugin_connector_1p_f8509de903288191b14a160c6c5d20b0.png"
      },
      {
        "id": "plugin_asdk_app_69c18c28f1188191bf5b8445c4ab0a2e",
        "name": "Notion",
        "description": "Notion docs and workflows",
        "href": "/plugins/plugin_asdk_app_69c18c28f1188191bf5b8445c4ab0a2e",
        "image": "/plugins-app/plugin_asdk_app_69c18c28f1188191bf5b8445c4ab0a2e.png"
      },
      {
        "id": "plugin_asdk_app_69a1d78e929881919bba0dbda1f6436d",
        "name": "Slack",
        "description": "Read and manage Slack",
        "href": "/plugins/plugin_asdk_app_69a1d78e929881919bba0dbda1f6436d",
        "image": "/plugins-app/plugin_asdk_app_69a1d78e929881919bba0dbda1f6436d.png"
      }
    ],
    "moreLabel": "查看Outlook Email、Granola，以及更多",
    "moreHref": "/plugins?category=featured",
    "moreIcons": [
      {
        "name": "Outlook Email",
        "image": "/plugins-app/more-featured-0.png"
      },
      {
        "name": "Granola",
        "image": "/plugins-app/plugin_asdk_app_697761cab6f48191b5ed345919a3ce8b.png"
      },
      {
        "name": "Fireflies",
        "image": "/plugins-app/more-productivity-1.png"
      }
    ]
  },
  {
    "title": "效率",
    "slug": "productivity",
    "cards": [
      {
        "id": "plugin_asdk_app_697761cab6f48191b5ed345919a3ce8b",
        "name": "Granola",
        "description": "Add your meeting context",
        "href": "/plugins/plugin_asdk_app_697761cab6f48191b5ed345919a3ce8b",
        "image": "/plugins-app/plugin_asdk_app_697761cab6f48191b5ed345919a3ce8b.png"
      },
      {
        "id": "plugin_connector_6912075cb358819187346bcafb601db8",
        "name": "Fireflies",
        "description": "Search meeting transcripts",
        "href": "/plugins/plugin_connector_6912075cb358819187346bcafb601db8",
        "image": "/plugins-app/more-productivity-1.png"
      },
      {
        "id": "plugin_connector_1p_fd0f4f41caa88191a9456514bbffa06d",
        "name": "Outlook Calendar",
        "description": "Manage Outlook schedules",
        "href": "/plugins/plugin_connector_1p_fd0f4f41caa88191a9456514bbffa06d",
        "image": "/plugins-app/more-featured-2.png"
      },
      {
        "id": "plugin_asdk_app_69f3c30d68288191bbd428a394a78407",
        "name": "Plaud",
        "description": "Retrieve insights from Plaud",
        "href": "/plugins/plugin_asdk_app_69f3c30d68288191bbd428a394a78407",
        "image": "/plugins-app/plugin_asdk_app_69f3c30d68288191bbd428a394a78407.png"
      },
      {
        "id": "plugin_asdk_app_695d84e2f06c8191861b9bac9b3fd53b",
        "name": "Otter.ai",
        "description": "Search meetings from Otter.ai",
        "href": "/plugins/plugin_asdk_app_695d84e2f06c8191861b9bac9b3fd53b",
        "image": "/plugins-app/plugin_asdk_app_695d84e2f06c8191861b9bac9b3fd53b.png"
      },
      {
        "id": "plugin_connector_692de805e3ec8191834719067174a384",
        "name": "Atlassian Rovo",
        "description": "Manage Jira and Confluence",
        "href": "/plugins/plugin_connector_692de805e3ec8191834719067174a384",
        "image": "/plugins-app/plugin_connector_692de805e3ec8191834719067174a384.png"
      }
    ],
    "moreLabel": "查看Linear、monday.com，以及更多",
    "moreHref": "/plugins?category=productivity",
    "moreIcons": [
      {
        "name": "",
        "image": "/plugins-app/more-productivity-0.png"
      },
      {
        "name": "",
        "image": "/plugins-app/more-productivity-0.png"
      },
      {
        "name": "",
        "image": "/plugins-app/more-productivity-2.png"
      }
    ]
  },
  {
    "title": "创意",
    "slug": "creativity",
    "cards": [
      {
        "id": "plugin_connector_68df33b1a2d081918778431a9cfca8ba",
        "name": "Canva",
        "description": "Create, review, edit designs",
        "href": "/plugins/plugin_connector_68df33b1a2d081918778431a9cfca8ba",
        "image": "/plugins-app/more-featured-1.png"
      },
      {
        "id": "plugin_asdk_app_6a3293e129088191abf0875820e839da",
        "name": "Higgsfield",
        "description": "Every image and video model",
        "href": "/plugins/plugin_asdk_app_6a3293e129088191abf0875820e839da",
        "image": "/plugins-app/plugin_asdk_app_6a3293e129088191abf0875820e839da.png"
      },
      {
        "id": "Plugin_fa77aec24fc08191bc6e57f377126d76",
        "name": "Product Design",
        "description": "Explore and prototype ideas",
        "href": "/plugins/Plugin_fa77aec24fc08191bc6e57f377126d76",
        "image": "/plugins-app/Plugin_fa77aec24fc08191bc6e57f377126d76.png"
      },
      {
        "id": "plugin_connector_68df038e0ba48191908c8434991bbac2",
        "name": "Figma",
        "description": "Figma design-to-code workflows",
        "href": "/plugins/plugin_connector_68df038e0ba48191908c8434991bbac2",
        "image": "/plugins-app/plugin_connector_68df038e0ba48191908c8434991bbac2.png"
      },
      {
        "id": "plugin_asdk_app_6a1f227d5a848191ae3317c66947b440",
        "name": "Magnific",
        "description": "Create images, video, designs",
        "href": "/plugins/plugin_asdk_app_6a1f227d5a848191ae3317c66947b440",
        "image": "/plugins-app/plugin_asdk_app_6a1f227d5a848191ae3317c66947b440.png"
      },
      {
        "id": "plugin_asdk_app_69418aad55e08191aa5e437b649ca2e4",
        "name": "HeyGen",
        "description": "Create AI videos",
        "href": "/plugins/plugin_asdk_app_69418aad55e08191aa5e437b649ca2e4",
        "image": "/plugins-app/more-creativity-0.png"
      }
    ],
    "moreLabel": "查看Mobbin、Runway，以及更多",
    "moreHref": "/plugins?category=creativity",
    "moreIcons": [
      {
        "name": "",
        "image": "/plugins-app/more-creativity-0.png"
      },
      {
        "name": "",
        "image": "/plugins-app/more-creativity-1.png"
      },
      {
        "name": "",
        "image": "/plugins-app/more-creativity-2.png"
      }
    ]
  },
  {
    "title": "开发者工具",
    "slug": "developer-tools",
    "cards": [
      {
        "id": "plugin_asdk_app_69e8c7f174a08191a28b6da96c8062c4",
        "name": "Datadog (Preview)",
        "description": "Search and act on your data",
        "href": "/plugins/plugin_asdk_app_69e8c7f174a08191a28b6da96c8062c4",
        "image": "/plugins-app/more-developer-tools-2.png"
      },
      {
        "id": "plugin_asdk_app_69d3e5ee6a708191baa733f7b8931995",
        "name": "Supabase",
        "description": "Manage and query databases",
        "href": "/plugins/plugin_asdk_app_69d3e5ee6a708191baa733f7b8931995",
        "image": "/plugins-app/plugin_asdk_app_69d3e5ee6a708191baa733f7b8931995.png"
      },
      {
        "id": "plugin_connector_690a90ec05c881918afb6a55dc9bbaa1",
        "name": "Vercel",
        "description": "Build and deploy web apps and agents",
        "href": "/plugins/plugin_connector_690a90ec05c881918afb6a55dc9bbaa1",
        "image": "/plugins-app/plugin_connector_690a90ec05c881918afb6a55dc9bbaa1.png"
      },
      {
        "id": "plugin_asdk_app_69ea4ed2cf7c8191b742ef3622479ddd",
        "name": "Exa",
        "description": "Web search for AI agents",
        "href": "/plugins/plugin_asdk_app_69ea4ed2cf7c8191b742ef3622479ddd",
        "image": "/plugins-app/plugin_asdk_app_69ea4ed2cf7c8191b742ef3622479ddd.png"
      },
      {
        "id": "plugin_asdk_app_69e0086d87088191a3edc052fa50c29f",
        "name": "Neon Postgres",
        "description": "Manage Neon Postgres databases",
        "href": "/plugins/plugin_asdk_app_69e0086d87088191a3edc052fa50c29f",
        "image": "/plugins-app/plugin_asdk_app_69e0086d87088191a3edc052fa50c29f.png"
      },
      {
        "id": "plugin_asdk_app_6a330a7730c081919892632d5baaec58",
        "name": "Devpost Hackathons",
        "description": "Find and submit to hackathons",
        "href": "/plugins/plugin_asdk_app_6a330a7730c081919892632d5baaec58",
        "image": "/plugins-app/plugin_asdk_app_6a330a7730c081919892632d5baaec58.png"
      }
    ],
    "moreLabel": "查看Context7、Base44，以及更多",
    "moreHref": "/plugins?category=developer-tools",
    "moreIcons": [
      {
        "name": "",
        "image": "/plugins-app/more-developer-tools-1.png"
      },
      {
        "name": "",
        "image": "/plugins-app/more-developer-tools-0.png"
      },
      {
        "name": "",
        "image": "/plugins-app/more-developer-tools-2.png"
      }
    ]
  },
  {
    "title": "业务与运营",
    "slug": "business-and-operations",
    "cards": [
      {
        "id": "plugin_asdk_app_69e65c430b3081919aa4d962ab5d1698",
        "name": "Shopify",
        "description": "Build and manage your store",
        "href": "/plugins/plugin_asdk_app_69e65c430b3081919aa4d962ab5d1698",
        "image": "/plugins-app/plugin_asdk_app_69e65c430b3081919aa4d962ab5d1698.png"
      },
      {
        "id": "plugin_asdk_app_6a193ef5e804819197c25f88d92d6bf7",
        "name": "Zoho CRM",
        "description": "Automate Sales Operations",
        "href": "/plugins/plugin_asdk_app_6a193ef5e804819197c25f88d92d6bf7",
        "image": "/plugins-app/plugin_asdk_app_6a193ef5e804819197c25f88d92d6bf7.png"
      },
      {
        "id": "plugin_asdk_app_697acb8e53d88191bf7a79e62012ae14",
        "name": "HubSpot",
        "description": "Insights to action in HubSpot",
        "href": "/plugins/plugin_asdk_app_697acb8e53d88191bf7a79e62012ae14",
        "image": "/plugins-app/plugin_asdk_app_697acb8e53d88191bf7a79e62012ae14.png"
      },
      {
        "id": "plugin_asdk_app_69bd664f2a908191a3a0a47eca8559d1",
        "name": "Apollo.io",
        "description": "Find buyers and close deals",
        "href": "/plugins/plugin_asdk_app_69bd664f2a908191a3a0a47eca8559d1",
        "image": "/plugins-app/plugin_asdk_app_69bd664f2a908191a3a0a47eca8559d1.png"
      },
      {
        "id": "plugin_asdk_app_6a0783a98c4c8191841404d786d4a4b9",
        "name": "Webflow",
        "description": "Manage Webflow sites",
        "href": "/plugins/plugin_asdk_app_6a0783a98c4c8191841404d786d4a4b9",
        "image": "/plugins-app/plugin_asdk_app_6a0783a98c4c8191841404d786d4a4b9.png"
      },
      {
        "id": "plugin_asdk_app_698a340b9230819188ba5a5eea79022d",
        "name": "ZoomInfo",
        "description": "B2B data and GTM insights",
        "href": "/plugins/plugin_asdk_app_698a340b9230819188ba5a5eea79022d",
        "image": "/plugins-app/plugin_asdk_app_698a340b9230819188ba5a5eea79022d.png"
      }
    ],
    "moreLabel": "查看Attio、Metricool for Social Media，以及更多",
    "moreHref": "/plugins?category=business-and-operations",
    "moreIcons": [
      {
        "name": "",
        "image": "/plugins-app/more-business-and-operations-0.png"
      },
      {
        "name": "",
        "image": "/plugins-app/more-business-and-operations-0.png"
      },
      {
        "name": "",
        "image": "/plugins-app/more-business-and-operations-2.png"
      }
    ]
  },
  {
    "title": "数据与分析",
    "slug": "data-and-analytics",
    "cards": [
      {
        "id": "plugin_asdk_app_699caef2d680819188727b0ddbb349dd",
        "name": "PostHog",
        "description": "Analyze your product data",
        "href": "/plugins/plugin_asdk_app_699caef2d680819188727b0ddbb349dd",
        "image": "/plugins-app/plugin_asdk_app_699caef2d680819188727b0ddbb349dd.png"
      },
      {
        "id": "Plugin_fc9843a6fb34819195d6c7802398a8a7",
        "name": "Data Analytics",
        "description": "Answer product and business questions with data",
        "href": "/plugins/Plugin_fc9843a6fb34819195d6c7802398a8a7",
        "image": "/plugins-app/Plugin_fc9843a6fb34819195d6c7802398a8a7.png"
      },
      {
        "id": "plugin_asdk_app_69b2e9aed45c8191b254b207dfcc2bb4",
        "name": "Mixpanel",
        "description": "Query and analyze Mixpanel",
        "href": "/plugins/plugin_asdk_app_69b2e9aed45c8191b254b207dfcc2bb4",
        "image": "/plugins-app/plugin_asdk_app_69b2e9aed45c8191b254b207dfcc2bb4.png"
      },
      {
        "id": "plugin_connector_1p_b1cefad35a80819184ba7ed35d601d34",
        "name": "BigQuery",
        "description": "Query and manage BigQuery",
        "href": "/plugins/plugin_connector_1p_b1cefad35a80819184ba7ed35d601d34",
        "image": "/plugins-app/plugin_connector_1p_b1cefad35a80819184ba7ed35d601d34.png"
      },
      {
        "id": "plugin_asdk_app_696a54f1c91c81919002b9153ce0e336",
        "name": "MotherDuck",
        "description": "Get answers from your data",
        "href": "/plugins/plugin_asdk_app_696a54f1c91c81919002b9153ce0e336",
        "image": "/plugins-app/plugin_asdk_app_696a54f1c91c81919002b9153ce0e336.png"
      },
      {
        "id": "plugin_asdk_app_6939ea66e1588191af5f9d2a52964d19",
        "name": "Coupler.io",
        "description": "Analyze data from 400+ apps",
        "href": "/plugins/plugin_asdk_app_6939ea66e1588191af5f9d2a52964d19",
        "image": "/plugins-app/plugin_asdk_app_6939ea66e1588191af5f9d2a52964d19.jpg"
      }
    ],
    "moreLabel": "查看Hex、Mixpanel Headless，以及更多",
    "moreHref": "/plugins?category=data-and-analytics",
    "moreIcons": [
      {
        "name": "",
        "image": "/plugins-app/more-data-and-analytics-0.jpg"
      },
      {
        "name": "",
        "image": "/plugins-app/more-data-and-analytics-1.png"
      },
      {
        "name": "",
        "image": "/plugins-app/more-data-and-analytics-2.png"
      }
    ]
  },
  {
    "title": "沟通",
    "slug": "communication",
    "cards": [
      {
        "id": "plugin_connector_1p_6bcb5879c73c819196abc70016166099",
        "name": "Outlook Email",
        "description": "Triage Outlook inboxes",
        "href": "/plugins/plugin_connector_1p_6bcb5879c73c819196abc70016166099",
        "image": "/plugins-app/more-featured-0.png"
      },
      {
        "id": "plugin_asdk_app_69a21e4058dc8191a6220fa911310d7b",
        "name": "Superhuman Mail",
        "description": "Best email+calendar assistant",
        "href": "/plugins/plugin_asdk_app_69a21e4058dc8191a6220fa911310d7b",
        "image": "/plugins-app/plugin_asdk_app_69a21e4058dc8191a6220fa911310d7b.png"
      },
      {
        "id": "plugin_connector_1p_eba8b52fe53881918408d4b46b957644",
        "name": "Teams",
        "description": "Summarize Teams and follow up",
        "href": "/plugins/plugin_connector_1p_eba8b52fe53881918408d4b46b957644",
        "image": "/plugins-app/plugin_connector_1p_eba8b52fe53881918408d4b46b957644.png"
      },
      {
        "id": "plugin_asdk_app_69373a13116c819189d046aea1278836",
        "name": "Zoom",
        "description": "Smart meeting insights from Zoom",
        "href": "/plugins/plugin_asdk_app_69373a13116c819189d046aea1278836",
        "image": "/plugins-app/plugin_asdk_app_69373a13116c819189d046aea1278836.jpg"
      },
      {
        "id": "plugin_asdk_app_6a323a8a890c819190480c9044395170",
        "name": "Hostinger Mail",
        "description": "Use Hostinger Mail",
        "href": "/plugins/plugin_asdk_app_6a323a8a890c819190480c9044395170",
        "image": "/plugins-app/plugin_asdk_app_6a323a8a890c819190480c9044395170.png"
      },
      {
        "id": "plugin_asdk_app_6a2e4ae9228881919b13aeb3f87ca03e",
        "name": "Mailopoly Inbox",
        "description": "Search, send emails & messages",
        "href": "/plugins/plugin_asdk_app_6a2e4ae9228881919b13aeb3f87ca03e",
        "image": "/plugins-app/plugin_asdk_app_6a2e4ae9228881919b13aeb3f87ca03e.png"
      }
    ],
    "moreLabel": "查看Rhythm AI Personality Tuner、LinkedIn Headline Rewriter，以及更多",
    "moreHref": "/plugins?category=communication",
    "moreIcons": [
      {
        "name": "",
        "image": "/plugins-app/more-communication-0.png"
      },
      {
        "name": "",
        "image": "/plugins-app/more-communication-1.png"
      },
      {
        "name": "",
        "image": "/plugins-app/more-communication-2.png"
      }
    ]
  },
  {
    "title": "教育与研究",
    "slug": "education-and-research",
    "cards": [
      {
        "id": "plugin_asdk_app_69a0d0b83b5881919dd5f0e53b525d31",
        "name": "Readwise",
        "description": "Save, read, search, and learn",
        "href": "/plugins/plugin_asdk_app_69a0d0b83b5881919dd5f0e53b525d31",
        "image": "/plugins-app/more-education-and-research-2.png"
      },
      {
        "id": "plugin_asdk_app_6a0bcefe6dbc8191acf88ce22e2eef3a",
        "name": "Acumen by Talarion",
        "description": "Keep your AI up to date.",
        "href": "/plugins/plugin_asdk_app_6a0bcefe6dbc8191acf88ce22e2eef3a",
        "image": "/plugins-app/plugin_asdk_app_6a0bcefe6dbc8191acf88ce22e2eef3a.png"
      },
      {
        "id": "plugin_asdk_app_6943e6f4a928819195962de16fb9ffe4",
        "name": "Consensus",
        "description": "Explore scientific research",
        "href": "/plugins/plugin_asdk_app_6943e6f4a928819195962de16fb9ffe4",
        "image": "/plugins-app/plugin_asdk_app_6943e6f4a928819195962de16fb9ffe4.png"
      },
      {
        "id": "plugin_asdk_app_6948b485f5bc8191adb4df13f369cec7",
        "name": "Sider Scholar",
        "description": "Search 350M+ Paper. Save. Chat",
        "href": "/plugins/plugin_asdk_app_6948b485f5bc8191adb4df13f369cec7",
        "image": "/plugins-app/plugin_asdk_app_6948b485f5bc8191adb4df13f369cec7.png"
      },
      {
        "id": "plugin_asdk_app_69fcf53d4d8481919b65501a96bbed02",
        "name": "Elicit",
        "description": "Search scientific literature",
        "href": "/plugins/plugin_asdk_app_69fcf53d4d8481919b65501a96bbed02",
        "image": "/plugins-app/plugin_asdk_app_69fcf53d4d8481919b65501a96bbed02.png"
      },
      {
        "id": "plugin_asdk_app_69439d715a7c8191aed9e2f6649e105f",
        "name": "SciSpace",
        "description": "For science and research",
        "href": "/plugins/plugin_asdk_app_69439d715a7c8191aed9e2f6649e105f",
        "image": "/plugins-app/plugin_asdk_app_69439d715a7c8191aed9e2f6649e105f.png"
      }
    ],
    "moreLabel": "查看Academic Writing Toolkit、Scite，以及更多",
    "moreHref": "/plugins?category=education-and-research",
    "moreIcons": [
      {
        "name": "",
        "image": "/plugins-app/more-education-and-research-0.png"
      },
      {
        "name": "",
        "image": "/plugins-app/more-education-and-research-1.png"
      },
      {
        "name": "",
        "image": "/plugins-app/more-education-and-research-2.png"
      }
    ]
  },
  {
    "title": "科学研究",
    "slug": "scientific-research",
    "cards": [
      {
        "id": "plugins_6a76572d8f8081918362aa7ff90947fb",
        "name": "NVIDIA BioNeMo Agent Toolkit",
        "description": "Skills for NVIDIA BioNeMo",
        "href": "/plugins/plugins_6a76572d8f8081918362aa7ff90947fb",
        "image": "/plugins-app/plugins_6a76572d8f8081918362aa7ff90947fb.png"
      },
      {
        "id": "plugin_asdk_app_6a8a0cf734e48191aec4c958de2d145c",
        "name": "Proto",
        "description": "Biological AI models and tools",
        "href": "/plugins/plugin_asdk_app_6a8a0cf734e48191aec4c958de2d145c",
        "image": "/plugins-app/plugin_asdk_app_6a8a0cf734e48191aec4c958de2d145c.png"
      },
      {
        "id": "Plugin_3d180245a1a881918476af7b5061e1e4",
        "name": "Life Sciences Literature",
        "description": "Find biomedical papers, preprints, and open-access full text",
        "href": "/plugins/Plugin_3d180245a1a881918476af7b5061e1e4",
        "image": "/plugins-app/Plugin_3d180245a1a881918476af7b5061e1e4.svg"
      },
      {
        "id": "plugins_6a820fc4552c819199199afae3bbee0a",
        "name": "Biohub ESM",
        "description": "Understand proteins with ESM",
        "href": "/plugins/plugins_6a820fc4552c819199199afae3bbee0a",
        "image": "/plugins-app/plugins_6a820fc4552c819199199afae3bbee0a.svg"
      },
      {
        "id": "Plugin_207a23b9d4cc81919415c2ecea139240",
        "name": "Adaptyv Bio",
        "description": "Plan and manage protein experiments with review gates",
        "href": "/plugins/Plugin_207a23b9d4cc81919415c2ecea139240",
        "image": "/plugins-app/Plugin_207a23b9d4cc81919415c2ecea139240.svg"
      },
      {
        "id": "plugin_asdk_app_6a60df60877081919ad4a8109d27535d",
        "name": "Undermind",
        "description": "Find and read research papers",
        "href": "/plugins/plugin_asdk_app_6a60df60877081919ad4a8109d27535d",
        "image": "/plugins-app/plugin_asdk_app_6a60df60877081919ad4a8109d27535d.png"
      }
    ],
    "moreLabel": "查看Molecular Structure Viewer、Life Sciences Databases，以及更多",
    "moreHref": "/plugins?category=scientific-research",
    "moreIcons": [
      {
        "name": "",
        "image": "/plugins-app/Plugin_915f0ebef1348191bdb283c643ee98ec.png"
      },
      {
        "name": "",
        "image": "/plugins-app/more-scientific-research-1.svg"
      },
      {
        "name": "",
        "image": "/plugins-app/more-scientific-research-2.png"
      }
    ]
  },
  {
    "title": "安全",
    "slug": "security",
    "cards": [
      {
        "id": "Plugin_1e648473be9c8191a91ac3947151af55",
        "name": "Codex Security",
        "description": "Scan your codebase for risks",
        "href": "/plugins/Plugin_1e648473be9c8191a91ac3947151af55",
        "image": "/plugins-app/Plugin_1e648473be9c8191a91ac3947151af55.png"
      },
      {
        "id": "plugin_asdk_app_6943d1778c8c81918f4c9ddf4849ca41",
        "name": "Malwarebytes",
        "description": "Verify links, domains, phones.",
        "href": "/plugins/plugin_asdk_app_6943d1778c8c81918f4c9ddf4849ca41",
        "image": "/plugins-app/plugin_asdk_app_6943d1778c8c81918f4c9ddf4849ca41.png"
      },
      {
        "id": "plugin_asdk_app_69ae8d10d5b48191bd9eadb52dfcc22d",
        "name": "Bitdefender",
        "description": "Tool designed to check URLs",
        "href": "/plugins/plugin_asdk_app_69ae8d10d5b48191bd9eadb52dfcc22d",
        "image": "/plugins-app/plugin_asdk_app_69ae8d10d5b48191bd9eadb52dfcc22d.png"
      },
      {
        "id": "plugin_asdk_app_6a033addd77881918cea85cd71109f80",
        "name": "Vanta",
        "description": "Build trust with Vanta",
        "href": "/plugins/plugin_asdk_app_6a033addd77881918cea85cd71109f80",
        "image": "/plugins-app/plugin_asdk_app_6a033addd77881918cea85cd71109f80.jpg"
      },
      {
        "id": "plugin_asdk_app_6a6109bb0d3081919f5cd03b3085e944",
        "name": "Ansvar Gateway",
        "description": "Laws, Security and Compliance",
        "href": "/plugins/plugin_asdk_app_6a6109bb0d3081919f5cd03b3085e944",
        "image": "/plugins-app/plugin_asdk_app_6a6109bb0d3081919f5cd03b3085e944.png"
      },
      {
        "id": "plugin_asdk_app_6a7dd0b7d3008191a892a481af10b413",
        "name": "Breeze",
        "description": "Explore security posture",
        "href": "/plugins/plugin_asdk_app_6a7dd0b7d3008191a892a481af10b413",
        "image": "/plugins-app/plugin_asdk_app_6a7dd0b7d3008191a892a481af10b413.png"
      }
    ],
    "moreLabel": "查看Skill Risk Check、NightVision，以及更多",
    "moreHref": "/plugins?category=security",
    "moreIcons": [
      {
        "name": "",
        "image": "/plugins-app/more-security-0.png"
      },
      {
        "name": "",
        "image": "/plugins-app/more-security-1.png"
      },
      {
        "name": "",
        "image": "/plugins-app/more-security-2.png"
      }
    ]
  },
  {
    "title": "金融",
    "slug": "finance",
    "cards": [
      {
        "id": "plugin_asdk_app_6a2baf2fad748191812393c3e00308ef",
        "name": "Longbridge",
        "description": "Stock quotes, financial data",
        "href": "/plugins/plugin_asdk_app_6a2baf2fad748191812393c3e00308ef",
        "image": "/plugins-app/plugin_asdk_app_6a2baf2fad748191812393c3e00308ef.png"
      },
      {
        "id": "plugin_asdk_app_69bc11db874881918718abaca20b68ce",
        "name": "Interactive Brokers (IBKR)",
        "description": "Analyze global markets",
        "href": "/plugins/plugin_asdk_app_69bc11db874881918718abaca20b68ce",
        "image": "/plugins-app/plugin_asdk_app_69bc11db874881918718abaca20b68ce.png"
      },
      {
        "id": "Plugin_b31b1ece54648191a6760ea4580bba3e",
        "name": "Public Equity Investing",
        "description": "Public equity PM research, long/short, earnings, ETF/index diligence, and memos",
        "href": "/plugins/Plugin_b31b1ece54648191a6760ea4580bba3e",
        "image": "/plugins-app/Plugin_b31b1ece54648191a6760ea4580bba3e.png"
      },
      {
        "id": "plugin_asdk_app_69b2bc50b4c0819189d86013d62ecc71",
        "name": "Quartr",
        "description": "Company research data",
        "href": "/plugins/plugin_asdk_app_69b2bc50b4c0819189d86013d62ecc71",
        "image": "/plugins-app/plugin_asdk_app_69b2bc50b4c0819189d86013d62ecc71.png"
      },
      {
        "id": "plugin_connector_691f721a77bc8191be115b65c85075c0",
        "name": "Alpaca",
        "description": "Market data: stocks & crypto",
        "href": "/plugins/plugin_connector_691f721a77bc8191be115b65c85075c0",
        "image": "/plugins-app/plugin_connector_691f721a77bc8191be115b65c85075c0.png"
      },
      {
        "id": "plugin_asdk_app_6965faefe2b081919a998e14aa25f738",
        "name": "Binance",
        "description": "Explore Binance market data",
        "href": "/plugins/plugin_asdk_app_6965faefe2b081919a998e14aa25f738",
        "image": "/plugins-app/more-finance-0.png"
      }
    ],
    "moreLabel": "查看PitchBook、Stripe，以及更多",
    "moreHref": "/plugins?category=finance",
    "moreIcons": [
      {
        "name": "",
        "image": "/plugins-app/more-finance-0.png"
      },
      {
        "name": "",
        "image": "/plugins-app/plugin_connector_690ab09fa43c8191bca40280e4563238.png"
      },
      {
        "name": "",
        "image": "/plugins-app/more-finance-2.png"
      }
    ]
  },
  {
    "title": "医疗健康",
    "slug": "healthcare",
    "cards": [
      {
        "id": "plugin_connector_1p_e569f8b8dfd08191903c9bd2cd7da9ac",
        "name": "Health",
        "description": "Connect and explore your health data",
        "href": "/plugins/plugin_connector_1p_e569f8b8dfd08191903c9bd2cd7da9ac",
        "image": "/plugins-app/plugin_connector_1p_e569f8b8dfd08191903c9bd2cd7da9ac.png"
      },
      {
        "id": "plugin_asdk_app_69beacb8780c81919104bb111b56346b",
        "name": "Fitness AI Connector",
        "description": "AI coach for your Garmin data",
        "href": "/plugins/plugin_asdk_app_69beacb8780c81919104bb111b56346b",
        "image": "/plugins-app/plugin_asdk_app_69beacb8780c81919104bb111b56346b.png"
      },
      {
        "id": "plugin_asdk_app_6a0694cbb2608191bbefb74ba810ab68",
        "name": "COROS",
        "description": "Workout data insights",
        "href": "/plugins/plugin_asdk_app_6a0694cbb2608191bbefb74ba810ab68",
        "image": "/plugins-app/plugin_asdk_app_6a0694cbb2608191bbefb74ba810ab68.png"
      },
      {
        "id": "plugin_asdk_app_69aef5b699a0819184512d57743fc1cd",
        "name": "Tredict",
        "description": "Analyze workouts, create plans",
        "href": "/plugins/plugin_asdk_app_69aef5b699a0819184512d57743fc1cd",
        "image": "/plugins-app/plugin_asdk_app_69aef5b699a0819184512d57743fc1cd.png"
      },
      {
        "id": "plugin_asdk_app_69b5c48a72348191b3ad5abf6ec5dbfb",
        "name": "Calorie Tracker",
        "description": "Track your food and calories",
        "href": "/plugins/plugin_asdk_app_69b5c48a72348191b3ad5abf6ec5dbfb",
        "image": "/plugins-app/plugin_asdk_app_69b5c48a72348191b3ad5abf6ec5dbfb.png"
      },
      {
        "id": "plugin_asdk_app_6a322b52a82c8191b7fb653f9e9f7891",
        "name": "freddy",
        "description": "Ask about your health data",
        "href": "/plugins/plugin_asdk_app_6a322b52a82c8191b7fb653f9e9f7891",
        "image": "/plugins-app/plugin_asdk_app_6a322b52a82c8191b7fb653f9e9f7891.png"
      }
    ],
    "moreLabel": "查看MyFitnessPal、CalorieCam，以及更多",
    "moreHref": "/plugins?category=healthcare",
    "moreIcons": [
      {
        "name": "",
        "image": "/plugins-app/more-healthcare-0.jpg"
      },
      {
        "name": "",
        "image": "/plugins-app/more-healthcare-2.png"
      },
      {
        "name": "",
        "image": "/plugins-app/more-healthcare-2.png"
      }
    ]
  },
  {
    "title": "旅行",
    "slug": "travel",
    "cards": [
      {
        "id": "plugin_asdk_app_694546cd042881919bb746a8dc300f38",
        "name": "Skyscanner",
        "description": "Find cheap flights",
        "href": "/plugins/plugin_asdk_app_694546cd042881919bb746a8dc300f38",
        "image": "/plugins-app/plugin_asdk_app_694546cd042881919bb746a8dc300f38.png"
      },
      {
        "id": "plugin_asdk_app_69c4d4163c8c819183a9bdcf6d2ac262",
        "name": "Trip.com",
        "description": "All-in-one Travel Companion",
        "href": "/plugins/plugin_asdk_app_69c4d4163c8c819183a9bdcf6d2ac262",
        "image": "/plugins-app/plugin_asdk_app_69c4d4163c8c819183a9bdcf6d2ac262.png"
      },
      {
        "id": "plugin_asdk_app_69848e517d0c819191695bf9b23f0208",
        "name": "Flight Network",
        "description": "Search and book flights",
        "href": "/plugins/plugin_asdk_app_69848e517d0c819191695bf9b23f0208",
        "image": "/plugins-app/more-travel-2.png"
      },
      {
        "id": "plugin_asdk_app_69a85fe44a188191a43c7dbc80186d70",
        "name": "eDreams",
        "description": "Find flights and hotels",
        "href": "/plugins/plugin_asdk_app_69a85fe44a188191a43c7dbc80186d70",
        "image": "/plugins-app/plugin_asdk_app_69a85fe44a188191a43c7dbc80186d70.png"
      },
      {
        "id": "plugin_asdk_app_69c1784c29208191a35b4ddef3c7e6d5",
        "name": "Wikiloc",
        "description": "Your perfect trail. Just ask.",
        "href": "/plugins/plugin_asdk_app_69c1784c29208191a35b4ddef3c7e6d5",
        "image": "/plugins-app/plugin_asdk_app_69c1784c29208191a35b4ddef3c7e6d5.jpg"
      },
      {
        "id": "plugin_asdk_app_6943d405cbac8191bc7aa723c333335e",
        "name": "komoot",
        "description": "Find outdoor sport routes",
        "href": "/plugins/plugin_asdk_app_6943d405cbac8191bc7aa723c333335e",
        "image": "/plugins-app/more-travel-0.png"
      }
    ],
    "moreLabel": "查看ForeFlight Mobile、trivago，以及更多",
    "moreHref": "/plugins?category=travel",
    "moreIcons": [
      {
        "name": "",
        "image": "/plugins-app/plugin_asdk_app_6a21c822e22c819194e65ec16411cb29.png"
      },
      {
        "name": "",
        "image": "/plugins-app/more-travel-1.png"
      },
      {
        "name": "",
        "image": "/plugins-app/more-travel-2.png"
      }
    ]
  },
  {
    "title": "娱乐",
    "slug": "entertainment",
    "cards": [
      {
        "id": "plugin_asdk_app_6938a94a61d881918ef32cb999ff937c",
        "name": "Apple Music",
        "description": "Build playlists and find music",
        "href": "/plugins/plugin_asdk_app_6938a94a61d881918ef32cb999ff937c",
        "image": "/plugins-app/more-entertainment-0.jpg"
      },
      {
        "id": "plugin_asdk_app_69ea8fff9b048191961dc39a99d1cf06",
        "name": "Podcast App",
        "description": "Find great podcasts",
        "href": "/plugins/plugin_asdk_app_69ea8fff9b048191961dc39a99d1cf06",
        "image": "/plugins-app/plugin_asdk_app_69ea8fff9b048191961dc39a99d1cf06.png"
      },
      {
        "id": "plugin_asdk_app_69a0e374670c819190761772d2092135",
        "name": "Chessy",
        "description": "Play Chess Against ChatGPT",
        "href": "/plugins/plugin_asdk_app_69a0e374670c819190761772d2092135",
        "image": "/plugins-app/plugin_asdk_app_69a0e374670c819190761772d2092135.png"
      },
      {
        "id": "plugin_asdk_app_6944570636288191b7944d8c4a3fb857",
        "name": "Shazam",
        "description": "Identify songs instantly",
        "href": "/plugins/plugin_asdk_app_6944570636288191b7944d8c4a3fb857",
        "image": "/plugins-app/plugin_asdk_app_6944570636288191b7944d8c4a3fb857.jpg"
      },
      {
        "id": "plugin_asdk_app_694515af58088191a8b0a0f5f0b6d767",
        "name": "Flixor",
        "description": "Movie & TV Recommender",
        "href": "/plugins/plugin_asdk_app_694515af58088191a8b0a0f5f0b6d767",
        "image": "/plugins-app/plugin_asdk_app_694515af58088191a8b0a0f5f0b6d767.png"
      },
      {
        "id": "plugin_asdk_app_69c28d6aedac81919502a88c2179e20c",
        "name": "Smart Chess:Train+Learn to win",
        "description": "Play+improve: coach+strategy",
        "href": "/plugins/plugin_asdk_app_69c28d6aedac81919502a88c2179e20c",
        "image": "/plugins-app/plugin_asdk_app_69c28d6aedac81919502a88c2179e20c.png"
      }
    ],
    "moreLabel": "查看Spotify、Background Music，以及更多",
    "moreHref": "/plugins?category=entertainment",
    "moreIcons": [
      {
        "name": "",
        "image": "/plugins-app/plugin_asdk_app_68de829bf7648191acd70a907364c67c.png"
      },
      {
        "name": "",
        "image": "/plugins-app/more-entertainment-1.png"
      },
      {
        "name": "",
        "image": "/plugins-app/more-entertainment-2.png"
      }
    ]
  },
  {
    "title": "其他",
    "slug": "other",
    "cards": [
      {
        "id": "plugin_asdk_app_6982856578088191a6cf4a963662adf0",
        "name": "Indeed",
        "description": "Find jobs tailored for you",
        "href": "/plugins/plugin_asdk_app_6982856578088191a6cf4a963662adf0",
        "image": "/plugins-app/plugin_asdk_app_6982856578088191a6cf4a963662adf0.png"
      },
      {
        "id": "plugin_asdk_app_69949aa62bf48191be5e57a01202beca",
        "name": "LinkedIn",
        "description": "Find the right professional",
        "href": "/plugins/plugin_asdk_app_69949aa62bf48191be5e57a01202beca",
        "image": "/plugins-app/more-other-1.png"
      },
      {
        "id": "plugin_asdk_app_6943a2c078b0819188de39e4fe168d9b",
        "name": "Tarot",
        "description": "Tarot Reading & Divination",
        "href": "/plugins/plugin_asdk_app_6943a2c078b0819188de39e4fe168d9b",
        "image": "/plugins-app/plugin_asdk_app_6943a2c078b0819188de39e4fe168d9b.png"
      },
      {
        "id": "plugin_asdk_app_6996f481ed0c8191852f9c34c6a97d44",
        "name": "idealista",
        "description": "Find properties to buy or rent",
        "href": "/plugins/plugin_asdk_app_6996f481ed0c8191852f9c34c6a97d44",
        "image": "/plugins-app/plugin_asdk_app_6996f481ed0c8191852f9c34c6a97d44.png"
      },
      {
        "id": "plugin_asdk_app_69fde861d3988191a7157df33544f855",
        "name": "Ask Tarot Cards",
        "description": "Tarot card readings",
        "href": "/plugins/plugin_asdk_app_69fde861d3988191a7157df33544f855",
        "image": "/plugins-app/plugin_asdk_app_69fde861d3988191a7157df33544f855.png"
      },
      {
        "id": "plugin_asdk_app_69dfa26ad60081919fb9e3a1a50e3e53",
        "name": "Etsy",
        "description": "Shop Home, Style & More",
        "href": "/plugins/plugin_asdk_app_69dfa26ad60081919fb9e3a1a50e3e53",
        "image": "/plugins-app/plugin_asdk_app_69dfa26ad60081919fb9e3a1a50e3e53.png"
      }
    ],
    "moreLabel": "查看Steer Astro、Homey，以及更多",
    "moreHref": "/plugins?category=other",
    "moreIcons": [
      {
        "name": "",
        "image": "/plugins-app/more-other-2.png"
      },
      {
        "name": "",
        "image": "/plugins-app/more-other-1.png"
      },
      {
        "name": "",
        "image": "/plugins-app/more-other-0.png"
      }
    ]
  }
]

export const ALL_PLUGINS = PLUGIN_SECTIONS.flatMap((section) => section.cards)

export const PLUGIN_BY_ID = new Map(ALL_PLUGINS.map((plugin) => [plugin.id, plugin]))
